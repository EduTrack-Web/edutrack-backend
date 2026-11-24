import { EventModel } from '@/modules/calendar/models/event.model.js'
import { UserModel } from '@/modules/auth/models/user.model.js'
import { notificationService } from '@/modules/notifications/services/notification.service.js'
import { sendEventReminderEmail } from '@/modules/auth/services/email.service.js'

const formatDuration = (minutes: number): string => {
  if (minutes >= 1440) return `${Math.round(minutes / 1440)} ngày`
  if (minutes >= 60) return `${Math.round(minutes / 60)} giờ`
  return `${minutes} phút`
}

export const checkAndSendReminders = async (): Promise<void> => {
  try {
    const now = new Date()
    const twoDaysLater = new Date(now.getTime() + 48 * 60 * 60 * 1000)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)

    const events = await EventModel.find({
      isCompleted: false,
      reminders: { $exists: true, $not: { $size: 0 } },
      $or: [
        {
          'recurrence.frequency': 'none',
          $or: [
            { startDate: { $gte: twoHoursAgo, $lte: twoDaysLater } },
            { deadline: { $gte: twoHoursAgo, $lte: twoDaysLater } },
          ],
        },
        {
          'recurrence.frequency': { $ne: 'none' },
          $or: [{ 'recurrence.until': null }, { 'recurrence.until': { $gte: twoHoursAgo } }],
        },
      ],
    }).lean()

    for (const event of events) {
      const occurrences: Date[] = []

      if (!event.recurrence || event.recurrence.frequency === 'none') {
        if (event.entryType === 'task' && event.deadline) {
          occurrences.push(new Date(event.deadline))
        } else {
          occurrences.push(new Date(event.startDate))
        }
      } else {
        const baseStart = new Date(event.startDate)
        const freq = event.recurrence.frequency
        const interval = Math.max(1, event.recurrence.interval || 1)
        const until = event.recurrence.until ? new Date(event.recurrence.until) : null
        const exceptionTimeSet = new Set(
          (event.exceptionDates || []).map((d) =>
            new Date(d as unknown as string | number | Date).toDateString(),
          ),
        )

        let cur = new Date(baseStart)
        let count = 0
        const maxOccurrences = Math.min(event.recurrence.count || 365, 365)

        while (count < maxOccurrences && cur <= twoDaysLater) {
          if (until && cur > until) break

          if (!exceptionTimeSet.has(cur.toDateString())) {
            if (cur >= twoHoursAgo && cur <= twoDaysLater) {
              occurrences.push(new Date(cur))
            }
          }

          count++
          if (freq === 'daily') {
            cur = new Date(cur.getTime() + interval * 24 * 60 * 60 * 1000)
          } else if (freq === 'weekly') {
            cur = new Date(cur.getTime() + interval * 7 * 24 * 60 * 60 * 1000)
          } else if (freq === 'monthly') {
            const nextMonth = new Date(cur)
            nextMonth.setMonth(nextMonth.getMonth() + interval)
            cur = nextMonth
          } else {
            cur = new Date(cur.getTime() + interval * 24 * 60 * 60 * 1000)
          }
        }
      }

      for (const occurrenceStart of occurrences) {
        for (const reminder of event.reminders || []) {
          const { method, minutesBefore } = reminder
          const triggerTime = occurrenceStart.getTime() - minutesBefore * 60 * 1000

          if (now.getTime() >= triggerTime && now.getTime() <= occurrenceStart.getTime() + 5 * 60 * 1000) {
            const reminderKey = `${event._id}_${occurrenceStart.getTime()}_${method}_${minutesBefore}`

            const updateResult = await EventModel.updateOne(
              {
                _id: event._id,
                'remindersSent.reminderKey': { $ne: reminderKey },
              },
              {
                $push: {
                  remindersSent: { reminderKey, sentAt: now },
                },
              },
            )

            if (updateResult.modifiedCount === 0) {
              continue
            }

            const owner = await UserModel.findById(event.userId).select('email fullName').lean()
            const acceptedGuests = (event.guests || []).filter((g) => g.status === 'accepted')
            const durationText = formatDuration(minutesBefore)

            const isTask = event.entryType === 'task'
            const reminderTitle = isTask ? `Nhắc nhở hạn chót: ${event.title}` : `Nhắc nhở: ${event.title}`
            const reminderMessage = isTask
              ? `Nhiệm vụ "${event.title}" sắp đến hạn chót sau ${durationText}.`
              : `Sự kiện "${event.title}" sẽ diễn ra sau ${durationText}.`

            if (method === 'in-app') {
              if (owner) {
                void notificationService.createNotification({
                  userId: String(owner._id),
                  type: 'event_reminder',
                  title: reminderTitle,
                  message: reminderMessage,
                  eventId: String(event._id),
                  link: '/calendar',
                  metadata: {
                    startDate: occurrenceStart.toISOString(),
                    location: event.location,
                  },
                })
              }

              for (const guest of acceptedGuests) {
                const guestUser = await UserModel.findOne({
                  email: guest.email.toLowerCase(),
                  status: 'active',
                }).lean()
                if (guestUser) {
                  void notificationService.createNotification({
                    userId: String(guestUser._id),
                    type: 'event_reminder',
                    title: reminderTitle,
                    message: reminderMessage,
                    eventId: String(event._id),
                    link: '/calendar',
                    metadata: {
                      startDate: occurrenceStart.toISOString(),
                      location: event.location,
                    },
                  })
                }
              }
            } else if (method === 'email') {
              if (owner?.email) {
                void sendEventReminderEmail(owner.email, {
                  title: event.title,
                  minutesBefore,
                  startDate: occurrenceStart,
                  location: event.location,
                  onlineMeetingUrl: event.onlineMeetingUrl,
                  description: event.description,
                })
              }

              for (const guest of acceptedGuests) {
                void sendEventReminderEmail(guest.email, {
                  title: event.title,
                  minutesBefore,
                  startDate: occurrenceStart,
                  location: event.location,
                  onlineMeetingUrl: event.onlineMeetingUrl,
                  description: event.description,
                })
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[ReminderScheduler] Lỗi khi quét nhắc nhở sự kiện:', error instanceof Error ? error.message : error)
  }
}

export const startReminderScheduler = (intervalMs = 30000): NodeJS.Timeout => {
  void checkAndSendReminders()
  return setInterval(() => {
    void checkAndSendReminders()
  }, intervalMs)
}
