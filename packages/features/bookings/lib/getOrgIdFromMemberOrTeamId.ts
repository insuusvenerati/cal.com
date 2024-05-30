import prisma from "@calcom/prisma";

// let's take this from org-wide webhooks PR
export const getOrgIdFromMemberOrTeamId = async (args: {
  memberId?: number | null;
  teamId?: number | null;
}) => {
  const userId = args.memberId ?? 0;
  const teamId = args.teamId ?? 0;

  const orgId = await prisma.team.findFirst({
    where: {
      OR: [
        {
          AND: [
            {
              members: {
                some: {
                  userId,
                },
              },
            },
            {
              isOrganization: true,
            },
          ],
        },
        {
          AND: [
            {
              children: {
                some: {
                  id: teamId,
                },
              },
            },
            {
              isOrganization: true,
            },
          ],
        },
      ],
    },
    select: {
      id: true,
    },
  });
  return orgId?.id;
};
