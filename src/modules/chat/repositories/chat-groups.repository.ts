import { Types } from 'mongoose'

import { UserModel } from '../../auth/models/user.model.js'
import { ChatGroupInviteLinkModel } from '../models/chat-group-invite-link.model.js'
import { ChatGroupInvitationModel } from '../models/chat-group-invitation.model.js'
import { ChatGroupMemberModel } from '../models/chat-group-member.model.js'
import { ChatGroupModel } from '../models/chat-group.model.js'
import { FriendshipModel } from '../models/friendship.model.js'
import { UserBlockModel } from '../models/user-block.model.js'
import type { ChatGroupHistoryVisibility, ChatGroupRole } from '../config/chat.config.js'

export const chatGroupsRepository = {
  findActiveUserById: (userId: string) =>
    UserModel.findOne({ _id: userId, status: 'active' }).select('fullName username avatarUrl').lean(),

  findActiveUsersByIds: (userIds: readonly string[]) =>
    UserModel.find({ _id: { $in: userIds }, status: 'active' })
      .select('fullName username avatarUrl')
      .lean(),

  findAcceptedFriendships: (userId: string, targetIds: readonly string[]) =>
    FriendshipModel.find({
      status: 'accepted',
      $or: [
        { userAId: userId, userBId: { $in: targetIds } },
        { userBId: userId, userAId: { $in: targetIds } },
      ],
    }).lean(),

  findBlocksBetween: (userId: string, targetIds: readonly string[]) =>
    UserBlockModel.find({
      $or: [
        { blockerId: userId, blockedId: { $in: targetIds } },
        { blockedId: userId, blockerId: { $in: targetIds } },
      ],
    }).lean(),

  createGroup: (input: {
    name: string
    description: string
    ownerId: string
    historyVisibility: ChatGroupHistoryVisibility
  }) => ChatGroupModel.create(input),

  insertMembers: (members: Array<{
    groupId: string
    userId: string
    role: ChatGroupRole
    joinedAt: Date
  }>) => ChatGroupMemberModel.insertMany(members),

  insertInvitations: (invitations: Array<{
    groupId: string
    inviteeId: string
    invitedById: string
  }>) => invitations.length > 0 ? ChatGroupInvitationModel.insertMany(invitations) : Promise.resolve([]),

  createInviteLink: (input: {
    groupId: string
    tokenHash: string
    createdById: string
    expiresAt: Date
  }) => ChatGroupInviteLinkModel.create(input),

  revokeActiveInviteLinks: (groupId: string, revokedAt: Date) =>
    ChatGroupInviteLinkModel.updateMany(
      { groupId, revokedAt: null, expiresAt: { $gt: revokedAt } },
      { $set: { revokedAt } },
    ),

  deleteGroupBundle: async (groupId: string): Promise<void> => {
    await Promise.all([
      ChatGroupInviteLinkModel.deleteMany({ groupId }),
      ChatGroupInvitationModel.deleteMany({ groupId }),
      ChatGroupMemberModel.deleteMany({ groupId }),
      ChatGroupModel.deleteOne({ _id: groupId }),
    ])
  },

  findMembershipsByUser: (userId: string) =>
    ChatGroupMemberModel.find({ userId }).sort({ updatedAt: -1, _id: -1 }).lean(),

  findGroupsByIds: (groupIds: readonly string[]) =>
    ChatGroupModel.find({ _id: { $in: groupIds }, status: 'active' }).lean(),

  findMembersByGroupIds: (groupIds: readonly string[]) =>
    ChatGroupMemberModel.find({ groupId: { $in: groupIds } }).lean(),

  findPendingInvitationsByGroupIds: (groupIds: readonly string[]) =>
    ChatGroupInvitationModel.find({ groupId: { $in: groupIds }, status: 'pending' }).lean(),

  findGroupById: (groupId: string) => ChatGroupModel.findOne({ _id: groupId, status: 'active' }).lean(),

  findMembership: (groupId: string, userId: string) => ChatGroupMemberModel.findOne({ groupId, userId }).lean(),

  findMembersByGroupId: (groupId: string) => ChatGroupMemberModel.find({ groupId }).lean(),

  findPendingInvitationsByGroupId: (groupId: string) =>
    ChatGroupInvitationModel.find({ groupId, status: 'pending' }).sort({ createdAt: -1 }).lean(),

  findInviteLinkByTokenHash: (tokenHash: string) => ChatGroupInviteLinkModel.findOne({ tokenHash }).lean(),

  findPendingInvitation: (groupId: string, inviteeId: string) =>
    ChatGroupInvitationModel.findOne({ groupId, inviteeId, status: 'pending' }).lean(),

  createMember: (input: { groupId: string; userId: string; role: ChatGroupRole; joinedAt: Date }) =>
    ChatGroupMemberModel.create(input),

  deleteMember: (groupId: string, userId: string) => ChatGroupMemberModel.deleteOne({ groupId, userId }),

  acceptInvitation: (groupId: string, inviteeId: string, acceptedAt: Date) =>
    ChatGroupInvitationModel.findOneAndUpdate(
      { groupId, inviteeId, status: 'pending' },
      { $set: { status: 'accepted', acceptedAt } },
      { new: true },
    ).lean(),

  toObjectIds: (values: readonly string[]) => values.map((value) => new Types.ObjectId(value)),
}
