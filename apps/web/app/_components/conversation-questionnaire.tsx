"use client";

import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { MultiSelector } from "@astryxdesign/core/MultiSelector";
import { Selector } from "@astryxdesign/core/Selector";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Text } from "@astryxdesign/core/Text";
import type { ConversationQuestionnaireState } from "@ventneuf/domain";
import { useState } from "react";

export function ConversationQuestionnaire({ form, currentMemberId, onSubmit }: {
  form: ConversationQuestionnaireState;
  currentMemberId?: string;
  onSubmit: (answers: Record<string, string[]>) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => form.answers
    ?? Object.fromEntries(form.questions.map(question => [question.id, question.defaultValues])));
  const [custom, setCustom] = useState<Record<string, boolean>>(() => Object.fromEntries(form.questions.map(question =>
    [question.id, question.defaultValues.some(value => !question.options.some(option => option.value === value))])));
  const [isSubmitting, setSubmitting] = useState(false);
  const [hasSubmitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();
  const answered = Boolean(form.answerMissionId || hasSubmitted);
  const setAnswer = (id: string, values: string[]) => setAnswers(current => ({ ...current, [id]: values }));
  const submit = async () => {
    if (form.questions.some(question => !answers[question.id]?.length || answers[question.id]!.some(value => !value.trim()))) {
      setError("Answer each question before continuing."); return;
    }
    setSubmitting(true); setError(undefined);
    try { await onSubmit(answers); setSubmitted(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to submit your answers."); }
    finally { setSubmitting(false); }
  };
  if (answered) return <VStack gap={2}>
    <Text type="supporting" weight="semibold">Answers sent</Text>
    {form.questions.map(question => <Text key={question.id} type="supporting">
      {question.label}: {(form.answers?.[question.id] ?? answers[question.id] ?? []).map(value =>
        question.options.find(option => option.value === value)?.label ?? value).join(", ")}
    </Text>)}
  </VStack>;
  if (currentMemberId !== form.requestedByMemberId) return <Text type="supporting">Waiting for answers from the member who requested this form.</Text>;
  return <VStack gap={4} width="100%" maxWidth={640} paddingBlock={3}>
    {form.questions.map(question => {
      const values = answers[question.id] ?? [];
      const textMode = question.mode === "text" || custom[question.id];
      return <VStack key={question.id} gap={1}>
        {textMode ? <TextArea label={question.label} value={values[0] ?? ""} onChange={value => setAnswer(question.id, [value])}
          rows={3} maxLength={2_000} isRequired isDisabled={isSubmitting} />
          : question.mode === "multiple" ? <MultiSelector label={question.label} options={question.options}
            value={values} onChange={value => setAnswer(question.id, value)} triggerDisplay="labels" isRequired isDisabled={isSubmitting} />
            : <Selector label={question.label} options={question.options} value={values[0] ?? ""}
              onChange={value => setAnswer(question.id, [value])} isRequired isDisabled={isSubmitting} />}
        {question.mode !== "text" ? <Button label={textMode ? "Choose from the suggestions" : "Write a different answer"}
          variant="ghost" size="sm" isDisabled={isSubmitting} onClick={() => {
            setCustom(current => ({ ...current, [question.id]: !textMode }));
            setAnswer(question.id, textMode ? question.defaultValues.filter(value => question.options.some(option => option.value === value)) : [values.join(", ")]);
          }} /> : null}
      </VStack>;
    })}
    {error ? <Text role="alert">{error}</Text> : null}
    <Button label="Continue with these answers" variant="primary" isLoading={isSubmitting} onClick={() => void submit()} />
  </VStack>;
}
