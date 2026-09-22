import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { HomePage } from "../pages/HomePage";
import { AppLayout } from "./AppLayout";

export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      {
        path: "/signup",
        lazy: async () => ({
          Component: (await import("../pages/SignUpPage")).SignUpPage,
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
