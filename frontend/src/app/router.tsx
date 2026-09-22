import { createBrowserRouter } from "react-router-dom";

import { HomePage } from "../pages/HomePage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <HomePage />,
  },
  {
    path: "/test",
    element: <p>La route fonctionne</p>,
  },
]);
