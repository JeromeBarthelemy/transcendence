import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { HomePage } from "../pages/HomePage";
import { AppLayout } from "./AppLayout";

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    // Opened first, a lazy page leaves the router nothing to draw while its
    // code arrives, and it warns in the console unless told what to show:
    // nothing, for those few milliseconds, as before.
    HydrateFallback: () => null,
    children: [
      { path: "/", element: <HomePage /> },
      {
        path: "*",
        lazy: async () => ({
          Component: (await import("../pages/NotFoundPage")).NotFoundPage,
        }),
      },
      {
        path: "/work-items/:workItemId",
        lazy: async () => ({
          Component: (await import("../pages/WorkItemPage")).WorkItemPage,
        }),
      },
      {
        path: "/signup",
        lazy: async () => ({
          Component: (await import("../pages/SignUpPage")).SignUpPage,
        }),
      },
      {
        path: "/teams",
        lazy: async () => ({
          Component: (await import("../pages/TeamsPage")).TeamsPage,
        }),
      },
      {
        path: "/rules/sources",
        lazy: async () => ({
          Component: (await import("../pages/RuleSourcesPage")).RuleSourcesPage,
        }),
      },
      {
        path: "/team-seasons/:teamSeasonId/days/:day",
        lazy: async () => ({
          Component: (await import("../pages/DaySummaryPage")).DaySummaryPage,
        }),
      },
      {
        path: "/users",
        lazy: async () => ({
          Component: (await import("../pages/UsersPage")).UsersPage,
        }),
      },
      {
        path: "/users/:userId",
        lazy: async () => ({
          Component: (await import("../pages/UsersPage")).UserDetailPage,
        }),
      },
      {
        path: "/profile",
        lazy: async () => ({
          Component: (await import("../pages/ProfilePage")).ProfilePage,
        }),
      },
      {
        path: "/fieldbot",
        lazy: async () => ({
          Component: (await import("../pages/FieldbotPage")).FieldbotPage,
        }),
      },
      {
        path: "/login",
        lazy: async () => ({
          Component: (await import("../pages/LoginPage")).LoginPage,
        }),
      },
      {
        path: "/privacy",
        lazy: async () => ({
          Component: (await import("../pages/LegalPages")).PrivacyPage,
        }),
      },
      {
        path: "/terms",
        lazy: async () => ({
          Component: (await import("../pages/LegalPages")).TermsPage,
        }),
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
