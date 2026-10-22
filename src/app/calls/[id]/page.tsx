import { notFound } from "next/navigation";
import { CallMode } from "@/components/CallMode";
import { getCall, getPrep, type CallSummary } from "@/lib/prep";
import { getRole } from "@/lib/repo";
import { ratingsOf } from "@/lib/rating";
import type { CallReview } from "@/lib/review";

export const dynamic = "force-dynamic";

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const call = getCall(Number((await params).id));
  const role = call ? getRole(call.job_id) : undefined;
  if (!call || !role) notFound();
  return (
    <CallMode
      callId={call.id}
      jobId={role.id}
      company={role.company_name}
      role={role.title}
      title={call.title ?? "Call"}
      startedAt={call.started_at}
      ended={!!call.ended_at}
      notes={call.notes}
      prep={getPrep(role.id)!.content}
      hasTranscript={!!call.transcript}
      recording={call.recording_path}
      ratings={ratingsOf(role)}
      transcriptStatus={call.transcript_status}
      transcribeProgress={call.transcribe_progress}
      transcribeError={call.transcribe_error}
      summary={call.summary ? (JSON.parse(call.summary) as CallSummary) : null}
      review={call.review ? (JSON.parse(call.review) as CallReview) : null}
      reviewStatus={call.review_status}
    />
  );
}
