import { z } from "zod";

export const notificationIdParamsSchema = z.object({ id: z.string().min(1) });

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  unreadOnly: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default(false),
  type: z.string().trim().min(1).max(80).optional(),
});

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
