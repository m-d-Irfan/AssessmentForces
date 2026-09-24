import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { validate } from "../../middlewares/validate.js";
import {
  listNotificationsHandler,
  markAllNotificationsReadHandler,
  markNotificationReadHandler,
  unreadNotificationCountHandler,
} from "./notification.controller.js";
import {
  notificationIdParamsSchema,
  notificationListQuerySchema,
} from "./notification.validation.js";

export const notificationRouter = Router();
notificationRouter.use(authenticate);

notificationRouter.get(
  "/",
  validate({ query: notificationListQuerySchema }),
  listNotificationsHandler,
);
notificationRouter.get("/unread-count", unreadNotificationCountHandler);
notificationRouter.post("/read-all", markAllNotificationsReadHandler);
notificationRouter.patch(
  "/:id/read",
  validate({ params: notificationIdParamsSchema }),
  markNotificationReadHandler,
);
