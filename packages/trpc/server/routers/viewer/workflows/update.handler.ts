import type { Prisma } from "@prisma/client";

import { isSMSOrWhatsappAction } from "@calcom/features/ee/workflows/lib/actionHelperFunctions";
import {
  deleteRemindersFromRemovedActiveOn,
  isAuthorizedToAddEventtypes,
  getBookingsForReminders,
  deleteAllReminders,
  scheduleBookingReminders,
} from "@calcom/features/ee/workflows/lib/updateHelperFunctions";
import { IS_SELF_HOSTED } from "@calcom/lib/constants";
import hasKeyInMetadata from "@calcom/lib/hasKeyInMetadata";
import type { PrismaClient } from "@calcom/prisma";
import { BookingStatus, WorkflowActions, WorkflowTriggerEvents } from "@calcom/prisma/enums";
import type { TrpcSessionUser } from "@calcom/trpc/server/trpc";

import { TRPCError } from "@trpc/server";

import { hasTeamPlanHandler } from "../teams/hasTeamPlan.handler";
import type { TUpdateInputSchema } from "./update.schema";
import {
  getSender,
  isAuthorized,
  removeSmsReminderFieldForBooking,
  upsertSmsReminderFieldForBooking,
} from "./util";

type UpdateOptions = {
  ctx: {
    user: NonNullable<TrpcSessionUser>;
    prisma: PrismaClient;
  };
  input: TUpdateInputSchema;
};

export const updateHandler = async ({ ctx, input }: UpdateOptions) => {
  const { user } = ctx;
  const { id, name, activeOn, steps, trigger, time, timeUnit, isActiveOnAll } = input;
  const userWorkflow = await ctx.prisma.workflow.findUnique({
    where: {
      id,
    },
    select: {
      id: true,
      userId: true,
      team: {
        select: {
          isOrganization: true,
        },
      },
      teamId: true,
      user: {
        select: {
          teams: true,
        },
      },
      steps: true,
      activeOn: true,
    },
  });

  const isOrg = !!userWorkflow?.team?.isOrganization;

  // todo: check in isAuthorized if user is admin or owner of org if it is an org
  const isUserAuthorized = await isAuthorized(userWorkflow, ctx.prisma, ctx.user.id, true);

  if (!isUserAuthorized || !userWorkflow) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  if (steps.find((step) => step.workflowId != id)) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const isCurrentUsernamePremium = hasKeyInMetadata(user, "isPremium") ? !!user.metadata.isPremium : false;

  let isTeamsPlan = false;
  if (!isCurrentUsernamePremium) {
    const { hasTeamPlan } = await hasTeamPlanHandler({ ctx });
    isTeamsPlan = !!hasTeamPlan;
  }
  const hasPaidPlan = IS_SELF_HOSTED || isCurrentUsernamePremium || isTeamsPlan || isOrg;

  const where: Prisma.EventTypeWhereInput = {};

  where.id = {
    in: activeOn,
  };

  let newActiveOn: number[] = [];
  let activeOnEventTypes: {
    id: number;
    children: {
      id: number;
    }[];
  }[] = [];
  const removedActiveOn: number[] = [];

  let activeOnWithChildren: number[] = [];

  if (!isOrg) {
    // activeOn are event types

    activeOnEventTypes = await ctx.prisma.eventType.findMany({
      where,
      select: {
        id: true,
        children: {
          select: {
            id: true,
          },
        },
      },
    });

    activeOnWithChildren = activeOnEventTypes
      .map((eventType) => [eventType.id].concat(eventType.children.map((child) => child.id)))
      .flat();

    const oldActiveOnEventTypes = await ctx.prisma.workflowsOnEventTypes.findMany({
      where: {
        workflowId: id,
      },
      select: {
        eventTypeId: true,
        eventType: {
          include: {
            children: true,
          },
        },
      },
    });

    const oldActiveOnEventTypeIds = oldActiveOnEventTypes
      .map((eventTypeRel) =>
        [eventTypeRel.eventType.id].concat(eventTypeRel.eventType.children.map((child) => child.id))
      )
      .flat();

    newActiveOn = activeOn.filter(
      (eventType) =>
        !oldActiveOnEventTypes ||
        !oldActiveOnEventTypes
          .map((oldEventType) => {
            return oldEventType.eventTypeId;
          })
          .includes(eventType)
    );

    await isAuthorizedToAddEventtypes(newActiveOn, userWorkflow?.teamId, userWorkflow?.userId);

    //remove all scheduled Email and SMS reminders for eventTypes that are not active any more
    const removedActiveOn = oldActiveOnEventTypeIds.filter(
      (eventTypeId) => !activeOnWithChildren.includes(eventTypeId)
    );

    //maybe I can call this after the if once and put it all into removedActiveOn
    await deleteRemindersFromRemovedActiveOn(removedActiveOn, userWorkflow.steps, ctx.user.id);

    if (userWorkflow.teamId) {
      //all children managed event types are added after
      where.parentId = null;
    }
    //update active on & reminders for new eventTypes
    await ctx.prisma.workflowsOnEventTypes.deleteMany({
      where: {
        workflowId: id,
      },
    });

    //todo: is there any harm to do this here already?
    //create all workflow - eventtypes relationships
    await ctx.prisma.workflowsOnEventTypes.createMany({
      data: activeOnEventTypes.map((eventType) => ({
        workflowId: id,
        eventTypeId: eventType.id,
      })),
    });
    await Promise.all(
      activeOnEventTypes.map((eventType) =>
        ctx.prisma.workflowsOnEventTypes.createMany({
          data: eventType.children.map((chEventType) => ({
            workflowId: id,
            eventTypeId: chEventType.id,
          })),
        })
      )
    );
  } else {
    // handle activeOnTeams
  }

  // schedule reminders if there are new activeOn teams or event types
  const newEventTypes = isOrg ? newActiveOn : [];
  const newTeams = isOrg ? newActiveOn : [];

  const bookingsForReminders = await getBookingsForReminders(newEventTypes, newTeams);

  await scheduleBookingReminders(
    bookingsForReminders,
    userWorkflow.steps,
    time,
    timeUnit,
    trigger,
    user.id,
    userWorkflow.teamId
  );

  // handle deleted and edited workflow steps
  userWorkflow.steps.map(async (oldStep) => {
    const newStep = steps.filter((s) => s.id === oldStep.id)[0];
    const remindersFromStep = await ctx.prisma.workflowReminder.findMany({
      where: {
        workflowStepId: oldStep.id,
      },
      include: {
        booking: true,
      },
    });
    //step was deleted
    if (!newStep) {
      // cancel all workflow reminders from deleted steps
      await deleteAllReminders(remindersFromStep);

      await ctx.prisma.workflowStep.delete({
        where: {
          id: oldStep.id,
        },
      });

      //step was edited
    } else if (JSON.stringify(oldStep) !== JSON.stringify(newStep)) {
      // check if step that require team plan already existed before
      if (!hasPaidPlan && !isSMSOrWhatsappAction(oldStep.action) && isSMSOrWhatsappAction(newStep.action)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Not available on free plan" });
      }

      // update step
      const requiresSender =
        newStep.action === WorkflowActions.SMS_NUMBER || newStep.action === WorkflowActions.WHATSAPP_NUMBER;
      await ctx.prisma.workflowStep.update({
        where: {
          id: oldStep.id,
        },
        data: {
          action: newStep.action,
          sendTo: requiresSender /*||
                newStep.action === WorkflowActions.EMAIL_ADDRESS*/
            ? newStep.sendTo
            : null,
          stepNumber: newStep.stepNumber,
          workflowId: newStep.workflowId,
          reminderBody: newStep.reminderBody,
          emailSubject: newStep.emailSubject,
          template: newStep.template,
          numberRequired: newStep.numberRequired,
          sender: getSender({
            action: newStep.action,
            sender: newStep.sender || null,
            senderName: newStep.senderName,
          }),
          numberVerificationPending: false,
          includeCalendarEvent: newStep.includeCalendarEvent,
        },
      });

      //cancel all reminders of step and create new ones (not for newEventTypes)
      const remindersToUpdate = remindersFromStep.filter(
        (reminder) => reminder.booking?.eventTypeId && !newEventTypes.includes(reminder.booking?.eventTypeId)
      );

      await deleteAllReminders(remindersToUpdate);

      // create new reminders for edited workflows
      const eventTypesToUpdateReminders = activeOn.filter(
        (eventTypeId) => !newEventTypes.includes(eventTypeId)
      );
      if (
        eventTypesToUpdateReminders &&
        (trigger === WorkflowTriggerEvents.BEFORE_EVENT || trigger === WorkflowTriggerEvents.AFTER_EVENT) &&
        newStep.action !== WorkflowActions.SMS_ATTENDEE &&
        newStep.action !== WorkflowActions.WHATSAPP_ATTENDEE
      ) {
        const bookingsOfEventTypes = await ctx.prisma.booking.findMany({
          where: {
            eventTypeId: {
              in: eventTypesToUpdateReminders,
            },
            status: BookingStatus.ACCEPTED,
            startTime: {
              gte: new Date(),
            },
          },
          include: {
            attendees: true,
            eventType: true,
            user: true,
          },
        });

        await scheduleBookingReminders(
          bookingsOfEventTypes,
          [newStep],
          time,
          timeUnit,
          trigger,
          user.id,
          userWorkflow.teamId
        );
      }
    }
  });

  // handle added workflow steps
  const addedSteps = steps
    .filter((step) => step.id <= 0)
    .map((s) => {
      if (isSMSOrWhatsappAction(s.action) && !hasPaidPlan) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Not available on free plan" });
      }
      const { id: _stepId, ...stepToAdd } = s;
      return stepToAdd;
    });

  if (addedSteps) {
    const bookingsForReminders = await ctx.prisma.booking.findMany({
      where: {
        eventTypeId: { in: activeOn },
        status: BookingStatus.ACCEPTED,
        startTime: {
          gte: new Date(),
        },
      },
      include: {
        attendees: true,
        eventType: true,
        user: true,
      },
    });

    //create new steps
    const createdSteps = await Promise.all(
      addedSteps.map((step) =>
        ctx.prisma.workflowStep.create({
          data: { ...step, numberVerificationPending: false },
        })
      )
    );

    await scheduleBookingReminders(
      bookingsForReminders,
      createdSteps,
      time,
      timeUnit,
      trigger,
      user.id,
      userWorkflow.teamId
    );
  }

  //update trigger, name, time, timeUnit
  await ctx.prisma.workflow.update({
    where: {
      id,
    },
    data: {
      name,
      trigger,
      time,
      timeUnit,
      isActiveOnAll,
    },
  });

  const workflow = await ctx.prisma.workflow.findFirst({
    where: {
      id,
    },
    include: {
      activeOn: {
        select: {
          eventType: true,
        },
      },
      team: {
        select: {
          id: true,
          slug: true,
          members: true,
          name: true,
          isOrganization: true,
        },
      },
      steps: {
        orderBy: {
          stepNumber: "asc",
        },
      },
    },
  });

  // Remove or add booking field for sms reminder number
  const smsReminderNumberNeeded =
    activeOn.length &&
    steps.some(
      (step) =>
        step.action === WorkflowActions.SMS_ATTENDEE || step.action === WorkflowActions.WHATSAPP_ATTENDEE
    );

  for (const removedEventType of removedActiveOn) {
    await removeSmsReminderFieldForBooking({
      workflowId: id,
      eventTypeId: removedEventType,
    });
  }

  for (const eventTypeId of activeOnWithChildren) {
    if (smsReminderNumberNeeded) {
      await upsertSmsReminderFieldForBooking({
        workflowId: id,
        isSmsReminderNumberRequired: steps.some(
          (s) =>
            (s.action === WorkflowActions.SMS_ATTENDEE || s.action === WorkflowActions.WHATSAPP_ATTENDEE) &&
            s.numberRequired
        ),
        eventTypeId,
      });
    } else {
      await removeSmsReminderFieldForBooking({ workflowId: id, eventTypeId });
    }
  }

  return {
    workflow,
  };
};
