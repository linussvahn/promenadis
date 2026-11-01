import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("sign-in", "routes/sign-in.tsx"),
  route("recover-account", "routes/recover-account.tsx"),
  route("auth/callback", "routes/auth-callback.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("events/new", "routes/new-event.tsx"),
  route("events/:eventId", "routes/event-overview.tsx"),
  route("events/:eventId/area", "routes/event-area.tsx"),
  route("events/:eventId/registration", "routes/event-registration.tsx"),
  route("events/:eventId/review", "routes/event-review.tsx"),
  route("settings", "routes/settings.tsx"),
  route("admin", "routes/admin.tsx"),
] satisfies RouteConfig;
