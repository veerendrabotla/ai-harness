/**
 * SCIM Provisioning Service.
 * Enterprise user provisioning via SCIM protocol.
 */
import type { PrismaClient } from "@prisma/client";
import { errors } from "@ai-harness/shared";
import pino from "pino";

const log = pino({ name: "scim", level: "warn" });

export interface SCIMUser {
  schemas: string[];
  id: string;
  externalId: string;
  userName: string;
  name: {
    givenName: string;
    familyName: string;
  };
  emails: Array<{
    value: string;
    type: string;
    primary: boolean;
  }>;
  active: boolean;
  meta: {
    resourceType: string;
    created: string;
    lastModified: string;
  };
}

export interface SCIMGroup {
  schemas: string[];
  id: string;
  displayName: string;
  members: Array<{
    value: string;
    $ref: string;
    type: string;
  }>;
}

export interface SCIMErrorResponse {
  schemas: string[];
  scimType?: string;
  detail: string;
  status: string;
}

function scimError(statusCode: string, detail: string, scimType?: string): SCIMErrorResponse {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    scimType,
    detail,
    status: statusCode,
  };
}

function toSCIMUser(user: {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: Date;
}): SCIMUser {
  const nameParts = user.displayName.split(" ");
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: user.id,
    externalId: user.id,
    userName: user.email,
    name: {
      givenName: nameParts[0] ?? "",
      familyName: nameParts.slice(1).join(" ") ?? "",
    },
    emails: [{ value: user.email, type: "work", primary: true }],
    active: user.status === "ACTIVE",
    meta: {
      resourceType: "User",
      created: user.createdAt.toISOString(),
      lastModified: user.createdAt.toISOString(),
    },
  };
}

/**
 * Provision user from SCIM.
 */
export async function provisionSCIMUser(
  prisma: PrismaClient,
  scimUser: SCIMUser,
  organizationId: string,
): Promise<string> {
  const email = scimUser.emails.find((e) => e.primary)?.value;
  if (!email) throw errors.validation("No primary email found");

  // Check if user already exists
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: "scim-managed",
        displayName: `${scimUser.name.givenName} ${scimUser.name.familyName}`,
        status: scimUser.active ? "ACTIVE" : "ACTIVE",
      },
    });
  }

  // Add to organization if not already a member
  const existingMembership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: user.id,
      },
    },
  });

  if (!existingMembership) {
    await prisma.organizationMember.create({
      data: {
        organizationId,
        userId: user.id,
        role: "MEMBER",
      },
    });
  }

  return user.id;
}

/**
 * Update user via SCIM PATCH operation.
 */
export async function patchSCIMUser(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  operations: Array<{ op: string; path?: string; value: unknown }>,
): Promise<void> {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!membership) throw errors.notFound("User in organization");

  for (const op of operations) {
    if (op.path === "active") {
      // Deactivate: remove from org. Reactivate: re-add.
      if (op.value === false) {
        await prisma.organizationMember.deleteMany({
          where: { userId, organizationId },
        });
      } else if (op.value === true) {
        const existing = await prisma.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
        });
        if (!existing) {
          await prisma.organizationMember.create({
            data: { organizationId, userId, role: "MEMBER" },
          });
        }
      }
    }
  }
}

/**
 * Deprovision user from SCIM.
 */
export async function deprovisionSCIMUser(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<void> {
  await prisma.organizationMember.deleteMany({
    where: {
      userId,
      organizationId,
    },
  });

  const membershipCount = await prisma.organizationMember.count({
    where: { userId },
  });

  if (membershipCount === 0) {
    log.info({ userId }, "SCIM: user has no remaining memberships — consider full deprovisioning");
  }
}

/**
 * Sync group from SCIM — resolves member userIds and syncs org membership.
 * Future: persist SCIM groups to a dedicated table for richer RBAC.
 */
export async function syncSCIMGroup(
  prisma: PrismaClient,
  scimGroup: SCIMGroup,
  organizationId: string,
): Promise<void> {
  log.info({ groupName: scimGroup.displayName, memberCount: scimGroup.members.length }, "SCIM: syncing group");

  // Resolve member emails → user IDs, then ensure org membership
  for (const member of scimGroup.members) {
    const memberId = member.value;
    if (!memberId) continue;
    // Member value is typically the SCIM user ID — look up the user
    const user = await prisma.user.findUnique({ where: { id: memberId } });
    if (!user) continue;
    const existing = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    if (!existing) {
      await prisma.organizationMember.create({
        data: { organizationId, userId: user.id, role: "MEMBER" },
      });
    }
  }
}

/**
 * Get SCIM user by ID.
 */
export async function getSCIMUser(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<SCIMUser | null> {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          createdAt: true,
        },
      },
    },
  });

  if (!membership) return null;

  return toSCIMUser(membership.user);
}

/**
 * List SCIM users in organization.
 */
export async function listSCIMUsers(
  prisma: PrismaClient,
  organizationId: string,
  startIndex: number,
  count: number,
): Promise<{ totalResults: number; Resources: SCIMUser[] }> {
  const memberships = await prisma.organizationMember.findMany({
    where: { organizationId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
          createdAt: true,
        },
      },
    },
    skip: startIndex,
    take: count,
  });

  const total = await prisma.organizationMember.count({ where: { organizationId } });

  return {
    totalResults: total,
    Resources: memberships.map((m) => toSCIMUser(m.user)),
  };
}

/**
 * Handle SCIM provisioning request.
 */
export async function handleSCIMRequest(
  prisma: PrismaClient,
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  organizationId: string = "default-org",
): Promise<unknown> {
  const scimPath = path.replace("/v1/scim/", "");

  switch (method) {
    case "POST": {
      if (scimPath === "/Users") {
        const user = body as unknown as SCIMUser;
        const userId = await provisionSCIMUser(prisma, user, organizationId);
        const created = await getSCIMUser(prisma, userId, organizationId);
        return created ?? { id: userId, success: true };
      }
      if (scimPath === "/Groups") {
        const group = body as unknown as SCIMGroup;
        await syncSCIMGroup(prisma, group, organizationId);
        return { id: group.id, success: true };
      }
      break;
    }
    case "PUT": {
      if (scimPath.startsWith("/Users/")) {
        const userId = scimPath.split("/")[2] ?? "";
        const user = body as unknown as SCIMUser;
        await provisionSCIMUser(prisma, user, organizationId);
        return await getSCIMUser(prisma, userId, organizationId) ?? { id: userId, success: true };
      }
      break;
    }
    case "PATCH": {
      if (scimPath.startsWith("/Users/")) {
        const userId = scimPath.split("/")[2] ?? "";
        const patchBody = body as { Operations?: Array<{ op: string; path?: string; value: unknown }> };
        const operations = patchBody.Operations ?? [];
        await patchSCIMUser(prisma, userId, organizationId, operations);
        return await getSCIMUser(prisma, userId, organizationId) ?? { id: userId, success: true };
      }
      break;
    }
    case "DELETE": {
      if (scimPath.startsWith("/Users/")) {
        const userId = scimPath.split("/")[2] ?? "";
        await deprovisionSCIMUser(prisma, userId, organizationId);
        return { success: true };
      }
      break;
    }
    case "GET": {
      if (scimPath === "/Users") {
        const users = await listSCIMUsers(prisma, organizationId, 0, 100);
        return {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
          ...users,
        };
      }
      if (scimPath.startsWith("/Users/")) {
        const userId = scimPath.split("/")[2] ?? "";
        const user = await getSCIMUser(prisma, userId, organizationId);
        if (!user) throw errors.notFound("User");
        return user;
      }
      if (scimPath === "/Groups") {
        return {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          totalResults: 0,
          Resources: [],
        };
      }
      break;
    }
  }

  throw scimError("404", "Endpoint not found");
}
