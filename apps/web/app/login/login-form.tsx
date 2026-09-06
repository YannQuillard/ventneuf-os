"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { VStack } from "@astryxdesign/core/Stack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import styles from "./login.module.css";

type Step = "credentials" | "forgot" | "new-password" | "reset-code" | "setup-totp" | "totp";

interface AuthResponse {
  code?: string;
  message?: string;
  qrCode?: string;
  secretCode?: string;
  step?: "authenticated" | "code" | "complete" | "new-password" | "setup-totp" | "totp";
}

class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function post(path: string, body: object): Promise<AuthResponse> {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const result = (await response.json().catch(() => ({}))) as AuthResponse;
  if (!response.ok) throw new AuthRequestError(result.message ?? "The request could not be completed.", result.code);
  return result;
}

function passwordIsValid(password: string): boolean {
  return (
    password.length >= 12 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [code, setCode] = useState("");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secretCode, setSecretCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function showStep(nextStep: Step) {
    setStep(nextStep);
    setError(null);
    setNotice(null);
    setCode("");
    setPassword("");
    setConfirmedPassword("");
  }

  function applyAuthResponse(result: AuthResponse) {
    if (result.step === "authenticated") {
      router.replace("/");
      router.refresh();
      return;
    }
    if (result.step === "totp" || result.step === "new-password") {
      showStep(result.step);
      return;
    }
    if (result.step === "setup-totp" && result.qrCode && result.secretCode) {
      setQrCode(result.qrCode);
      setSecretCode(result.secretCode);
      showStep("setup-totp");
      return;
    }
    throw new AuthRequestError("Cognito returned an unexpected sign-in step.");
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (caught) {
      const failure = caught instanceof AuthRequestError ? caught : null;
      if (failure?.code === "password_reset_required") {
        showStep("forgot");
        setNotice("Reset your password to continue.");
      } else {
        setError(failure?.message ?? "Sign in could not be completed.");
      }
    } finally {
      setBusy(false);
    }
  }

  function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      applyAuthResponse(await post("/api/auth/sign-in", { action: "credentials", email, password }));
    });
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const action = step === "setup-totp" ? "setup-totp" : "verify-totp";
      applyAuthResponse(await post("/api/auth/sign-in", { action, code }));
    });
  }

  function submitNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmedPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!passwordIsValid(password)) {
      setError("Use at least 12 characters with uppercase, lowercase, a number, and a symbol.");
      return;
    }
    void run(async () => {
      applyAuthResponse(await post("/api/auth/sign-in", { action: "new-password", password }));
    });
  }

  function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await post("/api/auth/password-reset", { action: "request", email });
      showStep("reset-code");
      setNotice("If that account exists, a verification code is on its way.");
    });
  }

  function confirmReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmedPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!passwordIsValid(password)) {
      setError("Use at least 12 characters with uppercase, lowercase, a number, and a symbol.");
      return;
    }
    void run(async () => {
      await post("/api/auth/password-reset", { action: "confirm", code, email, password });
      showStep("credentials");
      setNotice("Your password is updated. Sign in with the new password.");
    });
  }

  const title = {
    credentials: "Sign in",
    forgot: "Reset your password",
    "new-password": "Choose a permanent password",
    "reset-code": "Enter the verification code",
    "setup-totp": "Protect your account",
    totp: "Two-step verification",
  }[step];
  const description = {
    credentials: "Enter your workspace credentials to continue.",
    forgot: "We will send a verification code to your email address.",
    "new-password": "Your invitation uses a temporary password. Replace it before continuing.",
    "reset-code": "Use the code from your email and choose a new password.",
    "setup-totp": "Scan this code with your authenticator app, then enter the six-digit code.",
    totp: "Enter the six-digit code from your authenticator app.",
  }[step];

  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <Center minHeight="100svh" padding={6}>
        <VStack
          width={440}
          maxWidth="calc(100vw - var(--spacing-12))"
          gap={6}
          className={styles.shell}
        >
          <div className={styles.brand}>
            <Text type="large" weight="semibold">ventneuf.os</Text>
          </div>

          <Card width="100%" padding={8} elevation="low">
            <VStack gap={6}>
              <VStack gap={1}>
                <Heading level={1}>{title}</Heading>
                <Text color="secondary">{description}</Text>
              </VStack>

              {notice ? <Banner status="success" title={notice} /> : null}
              {error ? <Banner status="error" title="Unable to continue" description={error} /> : null}

              {step === "credentials" ? (
                <form onSubmit={submitCredentials} aria-busy={busy}>
                  <FormLayout defaultOptionality="required">
                    <TextInput
                      label="Email"
                      type="email"
                      htmlName="email"
                      value={email}
                      onChange={setEmail}
                      isDisabled={busy}
                      width="100%"
                    />
                    <TextInput
                      label="Password"
                      type="password"
                      htmlName="password"
                      value={password}
                      onChange={setPassword}
                      isDisabled={busy}
                      width="100%"
                    />
                    <Button type="submit" label="Sign in" variant="primary" width="100%" isLoading={busy} />
                    <Button
                      label="Forgot password?"
                      variant="ghost"
                      width="100%"
                      isDisabled={busy}
                      onClick={() => showStep("forgot")}
                    />
                  </FormLayout>
                </form>
              ) : null}

              {step === "forgot" ? (
                <form onSubmit={requestReset} aria-busy={busy}>
                  <FormLayout defaultOptionality="required">
                    <TextInput
                      label="Email"
                      type="email"
                      htmlName="email"
                      value={email}
                      onChange={setEmail}
                      isDisabled={busy}
                      width="100%"
                    />
                    <Button type="submit" label="Send verification code" variant="primary" width="100%" isLoading={busy} />
                    <Button label="Back to sign in" variant="ghost" width="100%" onClick={() => showStep("credentials")} />
                  </FormLayout>
                </form>
              ) : null}

              {step === "new-password" || step === "reset-code" ? (
                <form onSubmit={step === "new-password" ? submitNewPassword : confirmReset} aria-busy={busy}>
                  <FormLayout defaultOptionality="required">
                    {step === "reset-code" ? (
                      <TextInput
                        label="Verification code"
                        htmlName="code"
                        value={code}
                        onChange={setCode}
                        isDisabled={busy}
                        hasAutoFocus
                        width="100%"
                      />
                    ) : null}
                    <TextInput
                      label="New password"
                      description="12+ characters with uppercase, lowercase, a number, and a symbol"
                      type="password"
                      htmlName="new-password"
                      value={password}
                      onChange={setPassword}
                      isDisabled={busy}
                      width="100%"
                    />
                    <TextInput
                      label="Confirm new password"
                      type="password"
                      htmlName="confirm-password"
                      value={confirmedPassword}
                      onChange={setConfirmedPassword}
                      isDisabled={busy}
                      width="100%"
                    />
                    <Button type="submit" label="Save new password" variant="primary" width="100%" isLoading={busy} />
                    {step === "reset-code" ? (
                      <Button label="Start over" variant="ghost" width="100%" onClick={() => showStep("forgot")} />
                    ) : null}
                  </FormLayout>
                </form>
              ) : null}

              {step === "totp" || step === "setup-totp" ? (
                <form onSubmit={submitCode} aria-busy={busy}>
                  <FormLayout defaultOptionality="required">
                    {step === "setup-totp" && qrCode && secretCode ? (
                      <div className={styles.setup}>
                        <img className={styles.qrCode} src={qrCode} alt="Authenticator setup QR code" />
                        <VStack gap={1}>
                          <Text type="supporting">Manual setup key</Text>
                          <Text type="code" wordBreak="break-all">{secretCode}</Text>
                        </VStack>
                      </div>
                    ) : null}
                    <TextInput
                      label="Six-digit code"
                      htmlName="code"
                      value={code}
                      onChange={setCode}
                      isDisabled={busy}
                      hasAutoFocus
                      width="100%"
                    />
                    <Button
                      type="submit"
                      label={step === "setup-totp" ? "Finish setup" : "Verify code"}
                      variant="primary"
                      width="100%"
                      isLoading={busy}
                    />
                    {step === "totp" ? (
                      <Button label="Back to sign in" variant="ghost" width="100%" onClick={() => showStep("credentials")} />
                    ) : null}
                  </FormLayout>
                </form>
              ) : null}
            </VStack>
          </Card>
        </VStack>
      </Center>
    </main>
  );
}
