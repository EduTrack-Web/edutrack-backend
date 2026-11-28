export interface SyncRealtimeEventPayload {
  readonly reason: 'webhook' | 'worker' | 'manual'
  readonly calendarConnectionId?: string
  readonly timestamp: string
}

export interface SyncRealtimeSubscriber {
  readonly id: string
  send(eventName: string, payload: SyncRealtimeEventPayload): void
}

export class GoogleSyncRealtimeHub {
  private readonly subscribersByUser = new Map<string, Map<string, SyncRealtimeSubscriber>>()

  public subscribe(userId: string, subscriber: SyncRealtimeSubscriber): () => void {
    const userSubscribers =
      this.subscribersByUser.get(userId) ?? new Map<string, SyncRealtimeSubscriber>()
    userSubscribers.set(subscriber.id, subscriber)
    this.subscribersByUser.set(userId, userSubscribers)

    return () => {
      const activeMap = this.subscribersByUser.get(userId)
      if (!activeMap) return
      activeMap.delete(subscriber.id)
      if (activeMap.size === 0) {
        this.subscribersByUser.delete(userId)
      }
    }
  }

  public isUserOnline(userId: string): boolean {
    return (this.subscribersByUser.get(userId)?.size ?? 0) > 0
  }

  public notifyUserSynced(
    userId: string,
    params: { reason: 'webhook' | 'worker' | 'manual'; calendarConnectionId?: string },
  ): void {
    const userSubscribers = this.subscribersByUser.get(userId)
    if (!userSubscribers || userSubscribers.size === 0) return

    const payload: SyncRealtimeEventPayload = {
      reason: params.reason,
      ...(params.calendarConnectionId
        ? { calendarConnectionId: params.calendarConnectionId }
        : {}),
      timestamp: new Date().toISOString(),
    }

    for (const subscriber of userSubscribers.values()) {
      subscriber.send('google-calendar-synced', payload)
    }
  }
}

export const googleSyncRealtimeHub = new GoogleSyncRealtimeHub()
