import { AppShell } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { readSession } from "../lib/auth/session";
import { Workspace } from "./workspace";

export default async function Home() {
  const session = await readSession();

  if (!session) {
    return (
      <AppShell contentPadding={0}>
        <Center height="100%" padding={6}>
          <Card width="100%" maxWidth={440} padding={8} elevation="low">
            <VStack gap={6}>
              <VStack gap={2}>
                <Heading level={1}>Welcome to ventneuf.os</Heading>
                <Text color="secondary">
                  Sign in to access your conversations, knowledge, missions, and connected devices.
                </Text>
              </VStack>
              <Button label="Sign in" variant="primary" href="/auth/login" />
            </VStack>
          </Card>
        </Center>
      </AppShell>
    );
  }

  return <Workspace email={session.email} />;
}
