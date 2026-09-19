import { SequenceBuilder } from "@/components/sequences/SequenceBuilder";
import { loadTemplateOptions } from "@/components/sequences/load-options";

export const dynamic = "force-dynamic";

export default async function Page() {
  const templates = await loadTemplateOptions();
  return <SequenceBuilder mode="create" templates={templates} />;
}
