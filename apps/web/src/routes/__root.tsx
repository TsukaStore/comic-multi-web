import { Outlet, createRootRoute } from "@tanstack/react-router";

import { AppAuthGate } from "@/components/AppAuthGate";
import { Shell } from "@/components/Shell";

export const Route = createRootRoute({
  component: () => (
    <AppAuthGate>
      <Shell>
        <Outlet />
      </Shell>
    </AppAuthGate>
  ),
});
