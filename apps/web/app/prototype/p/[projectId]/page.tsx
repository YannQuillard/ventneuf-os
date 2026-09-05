import { notFound } from "next/navigation";
import { Suspense } from "react";
import { prototypeData } from "../../../../lib/prototype/fixtures";
import { ProjectScreen } from "../../_components/project-screen";

export const dynamicParams = false;

export function generateStaticParams() {
  return prototypeData.projects.map((project) => ({ projectId: project.id }));
}

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!prototypeData.projects.some((project) => project.id === projectId)) notFound();

  return (
    <Suspense fallback={null}>
      <ProjectScreen projectId={projectId} />
    </Suspense>
  );
}
