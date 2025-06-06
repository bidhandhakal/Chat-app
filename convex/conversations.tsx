import { ConvexError, v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getUserByClerkId } from "./_utils";
import { QueryCtx, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";

type ConversationWithTimestamp = {
    _id: Id<"conversations">;
    _creationTime: number;
    isGroup: boolean;
    name?: string;
    lastMessageId?: Id<"messages">;
    lastMessageTimestamp: number;
    [key: string]: any;
};

type ConversationDetails = {
    conversation: ConversationWithTimestamp;
    otherMember?: any;
    lastMessage: any;
    groupMembers?: string[];
} | null;

export const get = query({
    args: {},
    handler: async (ctx) => {
        try {
            const identity = await ctx.auth.getUserIdentity();

            if (!identity) {
                throw new Error("Unauthorized");
            }
            const currentUser = await getUserByClerkId(ctx, identity.subject);

            if (!currentUser) {
                throw new ConvexError("User not found");
            }

            const conversationMemberships = await ctx.db.query("conversationMembers")
                .withIndex("by_memberId", (q) => q.eq("memberId", currentUser._id))
                .collect();

            const conversationsPromises = conversationMemberships.map(async (membership) => {
                try {
                    if (!membership.conversationId) {
                        return null;
                    }

                    let conversation;
                    try {
                        conversation = await ctx.db.get(membership.conversationId);
                    } catch (error) {
                        console.error("Error fetching conversation:", error);
                        return null;
                    }

                    if (!conversation) {
                        return null;
                    }

                    let lastMessageTimestamp = 0;
                    if (conversation.lastMessageId) {
                        try {
                            const lastMessage = await ctx.db.get(conversation.lastMessageId);
                            if (lastMessage) {
                                lastMessageTimestamp = lastMessage._creationTime;
                            }
                        } catch (error) {
                            console.error("Error fetching last message:", error);
                        }
                    }

                    return {
                        ...conversation,
                        lastMessageTimestamp
                    };
                } catch (error) {
                    console.error("Error processing conversation membership:", error);
                    return null;
                }
            });

            let conversations: (ConversationWithTimestamp | null)[] = [];
            try {
                conversations = await Promise.all(conversationsPromises);
            } catch (error) {
                console.error("Error in Promise.all for conversations:", error);
                conversations = [];
            }

            const filteredConversations: ConversationWithTimestamp[] = conversations.filter(
                (conversation): conversation is ConversationWithTimestamp => conversation !== null
            );

            filteredConversations.sort((a, b) => {
                return b.lastMessageTimestamp - a.lastMessageTimestamp;
            });

            const detailsPromises = filteredConversations.map(async (conversation) => {
                try {
                    if (!conversation) return null;

                    let allconversationMemberships = [];
                    try {
                        allconversationMemberships = await ctx.db.query("conversationMembers")
                            .withIndex("by_conversationId", (q) => q.eq("conversationId", conversation._id))
                            .collect();
                    } catch (error) {
                        console.error("Error fetching conversation memberships:", error);
                        return null;
                    }

                    let lastMessage = null;
                    try {
                        lastMessage = await getLastMessageDetails({ ctx, id: conversation.lastMessageId });
                    } catch (error) {
                    }

                    if (conversation.isGroup) {
                        const memberUsernames = await Promise.all(
                            allconversationMemberships.map(async (membership) => {
                                try {
                                    const member = await ctx.db.get(membership.memberId);
                                    return member?.username || null;
                                } catch (error) {
                                    console.error("Error fetching member:", error);
                                    return null;
                                }
                            })
                        );

                        const groupMembers = memberUsernames.filter((username): username is string => username !== null);
                        return { conversation, lastMessage, groupMembers };
                    } else {
                        const otherMemberships = allconversationMemberships.filter(
                            (membership) => membership.memberId !== currentUser._id
                        );

                        if (!otherMemberships || otherMemberships.length === 0) {
                            return null;
                        }

                        const otherMembership = otherMemberships[0];

                        let otherMember = null;
                        try {
                            otherMember = await ctx.db.get(otherMembership.memberId);
                        } catch (error) {
                            console.error("Error fetching other member:", error);
                            return null;
                        }

                        if (!otherMember) {
                            return null;
                        }

                        return { conversation, otherMember, lastMessage };
                    }
                } catch (error) {
                    console.error("Error fetching conversation details:", error);
                    return null;
                }
            });

            let conversationsWithDetails: ConversationDetails[] = [];
            try {
                conversationsWithDetails = await Promise.all(detailsPromises);
            } catch (error) {
                console.error("Error in Promise.all for conversation details:", error);
                conversationsWithDetails = [];
            }

            return conversationsWithDetails.filter((item): item is NonNullable<ConversationDetails> => item !== null);

        } catch (error) {
            console.error("Top-level error in conversations.get:", error);
            return [];
        }
    },
});

const getLastMessageDetails = async ({ ctx, id }: { ctx: QueryCtx | MutationCtx; id: Id<"messages"> | undefined }) => {
    if (!id) return null;

    try {
        const messages = await ctx.db.get(id);
        if (!messages) return null;

        let sender = null;
        try {
            sender = await ctx.db.get(messages.senderId);
        } catch (error) {
            console.error("Error fetching message sender:", error);
            return null;
        }

        if (!sender) return null;

        const content = getMessageContent(messages.type, messages.content as unknown as string);

        return {
            content,
            sender: sender.username,
        };
    } catch (error) {
        console.error("Error in getLastMessageDetails:", error);
        return null;
    }
}

const getMessageContent = (type: string, content: string) => {
    switch (type) {
        case "text":
            return content;
        case "image":
            return "has sent an image.";
        default:
            return "has sent a document.";
    }
}

export const createGroup = mutation({
    args: {
        name: v.string(),
        memberIds: v.array(v.id("users")),
    },
    handler: async (ctx, args) => {
        try {
            const identity = await ctx.auth.getUserIdentity();

            if (!identity) {
                throw new Error("Unauthorized");
            }

            const currentUser = await getUserByClerkId(ctx, identity.subject);

            if (!currentUser) {
                throw new ConvexError("User not found");
            }

            const conversationId = await ctx.db.insert("conversations", {
                isGroup: true,
                name: args.name,
                lastMessageId: undefined,
                creatorId: currentUser._id,
            });

            await ctx.db.insert("conversationMembers", {
                conversationId,
                memberId: currentUser._id,
            });

            for (const memberId of args.memberIds) {
                await ctx.db.insert("conversationMembers", {
                    conversationId,
                    memberId,
                });
            }

            return conversationId;
        } catch (error) {
            console.error("Error creating group:", error);
            throw new ConvexError("Failed to create group");
        }
    },
});

export const leaveGroup = mutation({
    args: {
        conversationId: v.id("conversations"),
    },
    handler: async (ctx, args) => {
        try {
            const identity = await ctx.auth.getUserIdentity();

            if (!identity) {
                throw new Error("Unauthorized");
            }

            const currentUser = await getUserByClerkId(ctx, identity.subject);

            if (!currentUser) {
                throw new ConvexError("User not found");
            }

            const conversation = await ctx.db.get(args.conversationId);

            if (!conversation) {
                throw new ConvexError("Conversation not found");
            }

            if (!conversation.isGroup) {
                throw new ConvexError("This is not a group conversation");
            }

            const membership = await ctx.db
                .query("conversationMembers")
                .withIndex("by_memberId_conversationId", q =>
                    q.eq("memberId", currentUser._id).eq("conversationId", args.conversationId)
                )
                .unique();

            if (!membership) {
                throw new ConvexError("You are not a member of this group");
            }

            const isCreator = conversation.creatorId?.toString() === currentUser._id.toString();

            if (isCreator) {
                const otherMembers = await ctx.db
                    .query("conversationMembers")
                    .withIndex("by_conversationId", q => q.eq("conversationId", args.conversationId))
                    .filter(q => q.neq(q.field("memberId"), currentUser._id))
                    .collect();

                if (otherMembers.length === 0) {

                    await deleteGroupHandler(ctx, args);
                    return { success: true };
                }

                const newOwnerId = otherMembers[0].memberId;

                const conversation = await ctx.db.get(args.conversationId);
                if (conversation) {

                    await ctx.db.patch(args.conversationId, {
                        creatorId: newOwnerId
                    });
                }
            }


            await ctx.db.delete(membership._id);

            return { success: true };
        } catch (error) {
            console.error("Error leaving group:", error);
            throw new ConvexError("Failed to leave group");
        }
    }
});


async function deleteGroupHandler(ctx: MutationCtx, args: { conversationId: Id<"conversations"> }) {

    const members = await ctx.db
        .query("conversationMembers")
        .withIndex("by_conversationId", q => q.eq("conversationId", args.conversationId))
        .collect();

    for (const member of members) {
        await ctx.db.delete(member._id);
    }


    const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversationId", q => q.eq("conversationId", args.conversationId))
        .collect();

    for (const message of messages) {
        await ctx.db.delete(message._id);
    }

    await ctx.db.delete(args.conversationId);

    return { success: true };
}


export const deleteGroup = mutation({
    args: {
        conversationId: v.id("conversations"),
    },
    handler: async (ctx, args) => {
        try {
            const identity = await ctx.auth.getUserIdentity();

            if (!identity) {
                throw new Error("Unauthorized");
            }

            const currentUser = await getUserByClerkId(ctx, identity.subject);

            if (!currentUser) {
                throw new ConvexError("User not found");
            }


            const conversation = await ctx.db.get(args.conversationId);

            if (!conversation) {
                throw new ConvexError("Conversation not found");
            }


            if (!conversation.isGroup) {
                throw new ConvexError("This is not a group conversation");
            }


            if (conversation.creatorId?.toString() !== currentUser._id.toString()) {
                throw new ConvexError("Only the group creator can delete the group");
            }

            return await deleteGroupHandler(ctx, args);
        } catch (error) {
            console.error("Error deleting group:", error);
            throw new ConvexError("Failed to delete group");
        }
    }
});


export const isGroupCreator = query({
    args: {
        conversationId: v.id("conversations"),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();

        if (!identity) {
            return false;
        }

        const currentUser = await getUserByClerkId(ctx, identity.subject);

        if (!currentUser) {
            return false;
        }

        const conversation = await ctx.db.get(args.conversationId);

        if (!conversation || !conversation.isGroup) {
            return false;
        }

        return conversation.creatorId?.toString() === currentUser._id.toString();
    }
});

export const createGroupChat = mutation({
    args: {
        name: v.string(),
        memberIds: v.array(v.string()),
        imageUrl: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new ConvexError("Unauthorized");
        }

        const currentUser = await getUserByClerkId(ctx, identity.subject);
        if (!currentUser) {
            throw new ConvexError("User not found");
        }


        const conversationId = await ctx.db.insert("conversations", {
            isGroup: true,
            name: args.name,
            creatorId: currentUser._id,
            imageUrl: args.imageUrl,
        });


        await ctx.db.insert("conversationMembers", {
            conversationId,
            memberId: currentUser._id,
        });


        for (const memberId of args.memberIds) {
            const member = await ctx.db.get(memberId as Id<"users">);
            if (member) {
                await ctx.db.insert("conversationMembers", {
                    conversationId,
                    memberId: member._id,
                });
            }
        }

        return conversationId;
    },
});


export const updateGroupName = mutation({
    args: {
        conversationId: v.id("conversations"),
        name: v.string(),
    },
    handler: async (ctx, args) => {
        try {
            const identity = await ctx.auth.getUserIdentity();

            if (!identity) {
                throw new Error("Unauthorized");
            }

            const currentUser = await getUserByClerkId(ctx, identity.subject);

            if (!currentUser) {
                throw new ConvexError("User not found");
            }


            const conversation = await ctx.db.get(args.conversationId);

            if (!conversation) {
                throw new ConvexError("Conversation not found");
            }

            if (!conversation.isGroup) {
                throw new ConvexError("This is not a group conversation");
            }


            if (conversation.creatorId?.toString() !== currentUser._id.toString()) {
                throw new ConvexError("Only the group creator can update the group name");
            }


            await ctx.db.patch(args.conversationId, {
                name: args.name
            });

            return { success: true };
        } catch (error) {
            console.error("Error updating group name:", error);
            throw new ConvexError("Failed to update group name");
        }
    }
});


export const updateGroupImage = mutation({
    args: {
        conversationId: v.id("conversations"),
        imageUrl: v.string(),
    },
    handler: async (ctx, args) => {
        try {
            const identity = await ctx.auth.getUserIdentity();

            if (!identity) {
                throw new Error("Unauthorized");
            }

            const currentUser = await getUserByClerkId(ctx, identity.subject);

            if (!currentUser) {
                throw new ConvexError("User not found");
            }


            const conversation = await ctx.db.get(args.conversationId);

            if (!conversation) {
                throw new ConvexError("Conversation not found");
            }


            if (!conversation.isGroup) {
                throw new ConvexError("This is not a group conversation");
            }


            if (conversation.creatorId?.toString() !== currentUser._id.toString()) {
                throw new ConvexError("Only the group creator can update the group image");
            }

            await ctx.db.patch(args.conversationId, {
                imageUrl: args.imageUrl
            });

            return { success: true };
        } catch (error) {
            console.error("Error updating group image:", error);
            throw new ConvexError("Failed to update group image");
        }
    }
});


export const addGroupMembers = mutation({
    args: {
        conversationId: v.id("conversations"),
        memberIds: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        try {
            const identity = await ctx.auth.getUserIdentity();

            if (!identity) {
                throw new Error("Unauthorized");
            }

            const currentUser = await getUserByClerkId(ctx, identity.subject);

            if (!currentUser) {
                throw new ConvexError("User not found");
            }


            const conversation = await ctx.db.get(args.conversationId);

            if (!conversation) {
                throw new ConvexError("Conversation not found");
            }


            if (!conversation.isGroup) {
                throw new ConvexError("This is not a group conversation");
            }


            if (conversation.creatorId?.toString() !== currentUser._id.toString()) {
                throw new ConvexError("Only the group creator can add members to the group");
            }

            const existingMembers = await ctx.db
                .query("conversationMembers")
                .withIndex("by_conversationId", q => q.eq("conversationId", args.conversationId))
                .collect();

            const existingMemberIds = existingMembers.map(member => member.memberId.toString());


            let addedCount = 0;
            for (const memberId of args.memberIds) {
                const member = await ctx.db.get(memberId as Id<"users">);
                if (member && !existingMemberIds.includes(member._id.toString())) {
                    await ctx.db.insert("conversationMembers", {
                        conversationId: args.conversationId,
                        memberId: member._id,
                    });
                    addedCount++;
                }
            }

            return { success: true, addedCount };
        } catch (error) {
            console.error("Error adding group members:", error);
            throw new ConvexError("Failed to add members to group");
        }
    }
});


export const removeGroupMember = mutation({
    args: {
        conversationId: v.id("conversations"),
        memberId: v.string(),
    },
    handler: async (ctx, args) => {
        try {
            const identity = await ctx.auth.getUserIdentity();

            if (!identity) {
                throw new Error("Unauthorized");
            }

            const currentUser = await getUserByClerkId(ctx, identity.subject);

            if (!currentUser) {
                throw new ConvexError("User not found");
            }


            const conversation = await ctx.db.get(args.conversationId);

            if (!conversation) {
                throw new ConvexError("Conversation not found");
            }


            if (!conversation.isGroup) {
                throw new ConvexError("This is not a group conversation");
            }


            if (conversation.creatorId?.toString() !== currentUser._id.toString()) {
                throw new ConvexError("Only the group creator can remove members from the group");
            }


            const memberToRemove = await ctx.db.get(args.memberId as Id<"users">);
            if (!memberToRemove) {
                throw new ConvexError("Member not found");
            }

            if (memberToRemove._id.toString() === conversation.creatorId?.toString()) {
                throw new ConvexError("Cannot remove the group creator");
            }


            const membership = await ctx.db
                .query("conversationMembers")
                .withIndex("by_memberId_conversationId", q =>
                    q.eq("memberId", memberToRemove._id).eq("conversationId", args.conversationId)
                )
                .unique();

            if (!membership) {
                throw new ConvexError("This user is not a member of the group");
            }


            await ctx.db.delete(membership._id);

            return { success: true };
        } catch (error) {
            console.error("Error removing group member:", error);
            throw new ConvexError("Failed to remove member from group");
        }
    }
});