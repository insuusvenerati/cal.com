import type { Prisma } from "@prisma/client";

import prisma from "@calcom/prisma";

type TParams = {
  appType: string;
  appId: string;
  key?: Prisma.InputJsonValue;
  userId: number;
  teamId: number;
  subscriptionId?: string | null;
  paymentStatus?: string | null;
  billingCycleStart?: number | null;
};

const createSubTeamCredentials = async ({
  teamId,
  userId,
  appType,
  key,
  appId,
  subscriptionId,
  paymentStatus,
  billingCycleStart,
}: TParams) => {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      members: {
        some: {
          userId,
          accepted: true,
          role: {
            in: ["ADMIN", "OWNER"],
          },
        },
      },
    },
    select: {
      id: true,
      members: { select: { userId: true } },
      isOrganization: true,
      children: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!team) return;

  if (team.isOrganization) {
    // When installing an app to an organization, ensure it is added to all its sub-teams as well.
    const promises = team.children.map((childTeam) =>
      prisma.credential.create({
        data: {
          type: appType,
          key: key || {},
          teamId: childTeam.id,
          appId: appId,
          subscriptionId,
          paymentStatus,
          billingCycleStart,
        },
      })
    );
    const res = await Promise.all(promises);
    if (!res) throw new Error("Unable to create user credential for sub-teams");
  }
};
export default createSubTeamCredentials;
