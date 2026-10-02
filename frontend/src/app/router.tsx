import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { HomePage } from "../pages/HomePage";
import { AppLayout } from "./AppLayout";

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <HomePage /> },
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
        path: "/profile",
        lazy: async () => ({
          Component: (await import("../pages/ProfilePage")).ProfilePage,
        }),
      },
      {
        path: "/login",
        lazy: async () => ({
          Component: (await import("../pages/LoginPage")).LoginPage,
        }),
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
