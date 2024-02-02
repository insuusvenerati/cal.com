import { CreateAvailabilityInput } from "@/modules/availabilities/inputs/create-availability.input";
import { Type } from "class-transformer";
import { IsArray, IsOptional, IsString, ValidateNested } from "class-validator";

import { TimeZone } from "@calcom/platform-constants";

export class CreateScheduleInput {
  @IsString()
  name!: string;

  @IsString()
  timeZone!: TimeZone;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAvailabilityInput)
  @IsOptional()
  availabilities?: CreateAvailabilityInput[];
}