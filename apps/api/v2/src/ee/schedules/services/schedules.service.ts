import { SchedulesRepository } from "@/ee/schedules/schedules.repository";
import { InputSchedulesService } from "@/ee/schedules/services/input-schedules.service";
import { OutputSchedulesService } from "@/ee/schedules/services/output-schedules.service";
import { UsersRepository } from "@/modules/users/users.repository";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Schedule } from "@prisma/client";

import { CreateScheduleInput, ScheduleOutput } from "@calcom/platform-types";
import { UpdateScheduleInput } from "@calcom/platform-types";

@Injectable()
export class SchedulesService {
  constructor(
    private readonly schedulesRepository: SchedulesRepository,
    private readonly inputSchedulesService: InputSchedulesService,
    private readonly outputSchedulesService: OutputSchedulesService,
    private readonly usersRepository: UsersRepository
  ) {}

  async createUserDefaultSchedule(userId: number, timeZone: string) {
    const defaultSchedule = {
      isDefault: true,
      name: "Default schedule",
      timeZone,
    };

    return this.createUserSchedule(userId, defaultSchedule);
  }

  async createUserSchedule(userId: number, scheduleInput: CreateScheduleInput): Promise<ScheduleOutput> {
    const schedule = this.inputSchedulesService.transformInputCreateSchedule(scheduleInput);

    const createdSchedule = await this.schedulesRepository.createSchedule(userId, schedule);

    if (schedule.isDefault) {
      await this.usersRepository.setDefaultSchedule(userId, createdSchedule.id);
    }

    return this.outputSchedulesService.getResponseSchedule(createdSchedule);
  }

  async getUserScheduleDefault(userId: number) {
    const user = await this.usersRepository.findById(userId);

    if (!user?.defaultScheduleId) return null;

    const defaultSchedule = await this.schedulesRepository.getScheduleById(user.defaultScheduleId);

    if (!defaultSchedule) return null;
    return this.outputSchedulesService.getResponseSchedule(defaultSchedule);
  }

  async getUserSchedule(userId: number, scheduleId: number) {
    const existingSchedule = await this.schedulesRepository.getScheduleById(scheduleId);

    if (!existingSchedule) {
      throw new NotFoundException(`Schedule with ID=${scheduleId} does not exist.`);
    }

    this.checkUserOwnsSchedule(userId, existingSchedule);

    return this.outputSchedulesService.getResponseSchedule(existingSchedule);
  }

  async getUserSchedules(userId: number) {
    const schedules = await this.schedulesRepository.getSchedulesByUserId(userId);
    return Promise.all(
      schedules.map(async (schedule) => {
        return this.outputSchedulesService.getResponseSchedule(schedule);
      })
    );
  }

  async updateUserSchedule(userId: number, scheduleId: number, bodySchedule: UpdateScheduleInput) {
    const existingSchedule = await this.schedulesRepository.getScheduleById(scheduleId);

    if (!existingSchedule) {
      throw new NotFoundException(`Schedule with ID=${scheduleId} does not exist.`);
    }

    this.checkUserOwnsSchedule(userId, existingSchedule);

    const availability = bodySchedule.availability
      ? this.inputSchedulesService.transformInputScheduleAvailability(bodySchedule.availability)
      : undefined;
    const overrides = bodySchedule.overrides
      ? this.inputSchedulesService.transformInputOverrides(bodySchedule.overrides)
      : undefined;

    if (bodySchedule.isDefault) {
      await this.usersRepository.setDefaultSchedule(userId, scheduleId);
    }

    const updatedSchedule = await this.schedulesRepository.updateSchedule(userId, scheduleId, {
      ...bodySchedule,
      availability,
      overrides,
    });

    return this.outputSchedulesService.getResponseSchedule(updatedSchedule);
  }

  async deleteUserSchedule(userId: number, scheduleId: number) {
    const existingSchedule = await this.schedulesRepository.getScheduleById(scheduleId);

    if (!existingSchedule) {
      throw new BadRequestException(`Schedule with ID=${scheduleId} does not exist.`);
    }

    this.checkUserOwnsSchedule(userId, existingSchedule);

    return this.schedulesRepository.deleteScheduleById(scheduleId);
  }

  checkUserOwnsSchedule(userId: number, schedule: Pick<Schedule, "id" | "userId">) {
    if (userId !== schedule.userId) {
      throw new ForbiddenException(`User with ID=${userId} does not own schedule with ID=${schedule.id}`);
    }
  }
}
