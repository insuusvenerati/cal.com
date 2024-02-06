import { PrismaReadService } from "@/modules/prisma/prisma-read.service";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";
import { CreateUserInput } from "@/modules/users/inputs/create-user.input";
import { UpdateUserInput } from "@/modules/users/inputs/update-user.input";
import { Injectable } from "@nestjs/common";
import type { User } from "@prisma/client";

@Injectable()
export class UsersRepository {
  constructor(private readonly dbRead: PrismaReadService, private readonly dbWrite: PrismaWriteService) {}

  async create(user: CreateUserInput, oAuthClientId: string) {
    const newUser = await this.dbRead.prisma.user.create({
      data: {
        ...user,
        platformOAuthClients: {
          connect: { id: oAuthClientId },
        },
      },
    });

    return this.sanitize(newUser, ["password"]);
  }

  async findById(userId: number) {
    const user = await this.dbRead.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (user) {
      return this.sanitize(user, ["password"]);
    }

    return null;
  }

  async findByEmail(email: string) {
    const user = await this.dbRead.prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (user) {
      return this.sanitize(user, ["password"]);
    }

    return null;
  }

  async update(userId: number, updateData: UpdateUserInput) {
    const updatedUser = await this.dbWrite.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
    return this.sanitize(updatedUser, ["password"]);
  }

  async delete(userId: number): Promise<User> {
    return this.dbWrite.prisma.user.delete({
      where: { id: userId },
    });
  }

  sanitize<T extends keyof User>(user: User, keys: T[]): Omit<User, T> {
    const sanitizedUser = { ...user };

    keys.forEach((key) => {
      delete sanitizedUser[key];
    });

    return sanitizedUser;
  }

  setDefaultSchedule(userId: number, scheduleId: number) {
    return this.dbWrite.prisma.user.update({
      where: { id: userId },
      data: {
        defaultScheduleId: scheduleId,
      },
    });
  }
}