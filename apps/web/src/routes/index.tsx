import { createFileRoute } from "@tanstack/react-router";
import { AppShell, ListLayout, Text } from "@hackcove/ui-react";
import { greet } from "@hackcove/slashproduct-engine";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <AppShell>
      <ListLayout title="SlashProduct">
        <Text as="span">{greet("world")}</Text>
      </ListLayout>
    </AppShell>
  );
}
