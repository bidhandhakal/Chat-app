import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getUserByClerkId } from "./_utils";
import { Id } from "./_generated/dataModel";


type RequestWithSender = {
  _id: Id<"requests">;
  _creationTime: number;
  senderId: Id<"users">;
  receiverId: Id<"users">;
  status: string;
  sender?: {
    _id: Id<"users">;
    username?: string;
    imageUrl?: string;
    [key: string]: any;
  };
};

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      throw new Error("Unauthorized");
    }

    const currentUser = await getUserByClerkId(ctx, identity.subject);

    if (!currentUser) {
      throw new ConvexError("User not found");
    }

    const requests = await ctx.db
      .query("requests")
      .withIndex("by_receiverId_status", (q) =>
        q.eq("receiverId", currentUser._id).eq("status", "pending")
      )
      .collect();

    const requestsWithSender: RequestWithSender[] = await Promise.all(
      requests.map(async (request) => {
        const sender = await ctx.db.get(request.senderId);
        return {
          ...request,
          sender: sender || undefined,
        };
      })
    );

    return requestsWithSender;
  },
});

export const create = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthorized");

    if (!args.email.trim()) throw new ConvexError("Email cannot be empty");
    if (args.email === identity.email) throw new ConvexError("Can't send a request to yourself");

    const currentUser = await getUserByClerkId(ctx, identity.subject);
    if (!currentUser) throw new ConvexError("User not found");

    const receiver = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();

    if (!receiver) throw new ConvexError("User could not be found");


    const requestAlreadySent = await ctx.db
      .query("requests")
      .withIndex("by_senderId_receiverId", (q) =>
        q.eq("senderId", currentUser._id).eq("receiverId", receiver._id))
      .unique();

    if (requestAlreadySent) throw new ConvexError("Request already sent");


    const requestAlreadyReceived = await ctx.db
      .query("requests")
      .withIndex("by_senderId_receiverId", (q) =>
        q.eq("senderId", receiver._id).eq("receiverId", currentUser._id))
      .unique();

    if (requestAlreadyReceived) {
      throw new ConvexError("This user has already sent you a request");
    }


    const existingFriendship1 = await ctx.db
      .query("friendships")
      .withIndex("by_userIds", (q) =>
        q.eq("userId1", currentUser._id).eq("userId2", receiver._id))
      .unique();

    const existingFriendship2 = await ctx.db
      .query("friendships")
      .withIndex("by_userIds", (q) =>
        q.eq("userId1", receiver._id).eq("userId2", currentUser._id))
      .unique();

    if (existingFriendship1 || existingFriendship2) {
      throw new ConvexError("You are already friends with this user");
    }


    const request = await ctx.db.insert("requests", {
      senderId: currentUser._id,
      receiverId: receiver._id,
      status: "pending"
    });

    return request;
  },
});

export const createByUsername = mutation({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthorized");

    const currentUser = await getUserByClerkId(ctx, identity.subject);
    if (!currentUser) throw new ConvexError("User not found");

    if (!args.username.trim()) throw new ConvexError("Username cannot be empty");


    const usernameRegex = /^[a-zA-Z0-9_.-]+$/;
    if (!usernameRegex.test(args.username)) {
      throw new ConvexError("Username can only contain letters, numbers, underscores, periods, and hyphens");
    }


    const getCleanUsername = (text: string) => {

      let result = text;


      result = result.replace(/🛡️/gu, '');
      result = result.replace(/🛡/gu, '');
      result = result.replace(/👑/gu, '');


      result = result.replace(/[\u{1F600}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu, '');

      return result.trim().toLowerCase();
    };


    const normalizedInputUsername = args.username.toLowerCase();


    const cleanCurrentUsername = getCleanUsername(currentUser.username);
    if (currentUser.username.toLowerCase() === normalizedInputUsername || cleanCurrentUsername === normalizedInputUsername) {
      throw new ConvexError("Can't send a request to yourself");
    }


    let receiver = null;


    const allUsers = await ctx.db.query("users").collect();


    const foundUser = allUsers.find(user => {

      if (user.username.toLowerCase() === normalizedInputUsername) {
        return true;
      }


      if (user.username.toLowerCase() === normalizedInputUsername + "🛡️" ||
        user.username.toLowerCase() === normalizedInputUsername + "🛡" ||
        user.username.toLowerCase() === normalizedInputUsername + "👑") {
        return true;
      }


      const cleanUsername = getCleanUsername(user.username);
      return cleanUsername === normalizedInputUsername;
    });

    if (foundUser) {
      receiver = foundUser;
    }

    if (!receiver) throw new ConvexError("User with this username could not be found");


    const requestAlreadySent = await ctx.db
      .query("requests")
      .withIndex("by_senderId_receiverId", (q) =>
        q.eq("senderId", currentUser._id).eq("receiverId", receiver._id))
      .unique();

    if (requestAlreadySent) throw new ConvexError("Request already sent");


    const requestAlreadyReceived = await ctx.db
      .query("requests")
      .withIndex("by_senderId_receiverId", (q) =>
        q.eq("senderId", receiver._id).eq("receiverId", currentUser._id))
      .unique();

    if (requestAlreadyReceived) {
      throw new ConvexError("This user has already sent you a request");
    }


    const existingFriendship1 = await ctx.db
      .query("friendships")
      .withIndex("by_userIds", (q) =>
        q.eq("userId1", currentUser._id).eq("userId2", receiver._id))
      .unique();

    const existingFriendship2 = await ctx.db
      .query("friendships")
      .withIndex("by_userIds", (q) =>
        q.eq("userId1", receiver._id).eq("userId2", currentUser._id))
      .unique();

    if (existingFriendship1 || existingFriendship2) {
      throw new ConvexError("You are already friends with this user");
    }


    const request = await ctx.db.insert("requests", {
      senderId: currentUser._id,
      receiverId: receiver._id,
      status: "pending"
    });

    return request;
  },
});

export const deny = mutation({
  args: { id: v.id("requests") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthorized");

    const currentUser = await getUserByClerkId(ctx, identity.subject);
    if (!currentUser) throw new ConvexError("User not found");

    const request = await ctx.db.get(args.id);
    if (!request) throw new ConvexError("Request not found");

    if (request.receiverId !== currentUser._id) {
      throw new ConvexError("Request not found");
    }

    await ctx.db.delete(args.id);
  },
});

export const accept = mutation({
  args: { id: v.id("requests") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthorized");

    const currentUser = await getUserByClerkId(ctx, identity.subject);
    if (!currentUser) throw new ConvexError("User not found");

    const request = await ctx.db.get(args.id);
    if (!request || request.receiverId !== currentUser._id)
      throw new ConvexError("There was an error accepting this request");

    const conversationId = await ctx.db.insert("conversations", {
      isGroup: false,
    });


    await ctx.db.insert("friendships", {
      userId1: currentUser._id,
      userId2: request.senderId,
      status: "accepted"
    });


    await ctx.db.insert("conversationMembers", {
      memberId: currentUser._id,
      conversationId
    });

    await ctx.db.insert("conversationMembers", {
      memberId: request.senderId,
      conversationId
    });


    await ctx.db.delete(request._id);

    return { success: true };
  },
})