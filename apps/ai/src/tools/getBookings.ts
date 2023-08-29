import { DynamicStructuredTool } from "langchain/tools";
import { z } from "zod";

import { env } from "../env.mjs";
import type { Booking } from "../types/booking";
import { BOOKING_STATUS } from "../types/booking";
import { context } from "../utils/context";

/**
 * Fetches bookings for a user by date range.
 */
const fetchBookings = async ({
  from,
  to,
}: {
  from: string;
  to: string;
}): Promise<Booking[] | { error: string }> => {
  const params: { [k: string]: string } = {
    apiKey: context.apiKey,
    userId: context.userId,
  };

  const urlParams = new URLSearchParams(params);

  const url = `${env.BACKEND_URL}/bookings?${urlParams.toString()}`;

  const response = await fetch(url);

  if (response.status === 401) throw new Error("Unauthorized");

  const data = await response.json();

  if (response.status !== 200) {
    return { error: data.message };
  }

  const bookings: Booking[] = data.bookings
    .filter((booking: Booking) => {
      const afterFrom = new Date(booking.startTime).getTime() > new Date(from).getTime();
      const beforeTo = new Date(booking.endTime).getTime() < new Date(to).getTime();
      const notCancelled = booking.status !== BOOKING_STATUS.CANCELLED;

      return afterFrom && beforeTo && notCancelled;
    })
    .map(({ endTime, eventTypeId, id, startTime, status, title }: Booking) => ({
      endTime,
      eventTypeId,
      id,
      startTime,
      status,
      title,
    }));

  return bookings;
};

const getBookingsTool = new DynamicStructuredTool({
  description: "Get bookings for a user between two dates.",
  func: async ({ from, to }) => {
    return JSON.stringify(await fetchBookings({ from, to }));
  },
  name: "getBookings",
  schema: z.object({
    from: z.string().describe("ISO 8601 datetime string"),
    to: z.string().describe("ISO 8601 datetime string"),
  }),
});

export default getBookingsTool;