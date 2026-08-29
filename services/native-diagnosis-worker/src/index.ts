import { createHash } from 'node:crypto';
import {
  createKnowledgeClaimSchema,
  createSemanticRecordSchema,
  runtimeEventSchema,
} from '../../../packages/contracts/src/index.js';

export interface DiagnosisInput {
  organizationId: string;
  workspaceId: string;
  actorId: string;
  processRunId: string;
  answers: Record<string, unknown>;
}

export interface CandidateInput {
  id: string;
  name?: string;
  skills?: string[];
  experience?: string[];
  industry?: string;
  workStyle?: string[];
  motivation?: string[];
  constraints?: string[];
}

export interface BusinessDiagnosisRequest {
  organizationId: string;
  workspaceId: string;
  actorId: string;
  workItemId: string;
  processRunId: string;
  input: {
    business?: {
      name?: string;
      industry?: string;
      size?: string;
      stage?: string;
    };
    position?: {
      title: string;
      responsibilities: string[];
      requiredCapabilities?: string[];
      successCriteria?: string[];
    };
    candidates?: CandidateInput[];
    evidence?: Array<{ id: string; text: string; source?: string }>;
  };
}

export interface AxisEvaluation {
  score: number;
  evidence: string[];
}

export interface CandidateEvaluation {
  candidateId: string;
  axes: {
    capabilityFit: AxisEvaluation;
    experienceFit: AxisEvaluation;
    contextFit: AxisEvaluation;
    motivationFit: AxisEvaluation;
    riskAndReadiness: AxisEvaluation;
  };
  overallAssessment: string;
  confidence: number;
  missingEvidence: string[];
  recommendation: string;
}

export interface DiagnosisOutput {
  schemaVersion: 'business-diagnosis.v1';
  jobProfile: {
    title: string;
    responsibilities: string[];
    requiredCapabilities: string[];
    successCriteria: string[];
  };
  candidateEvaluations: CandidateEvaluation[];
  limitations: string[];
  generatedAt: string;
}

function boundedScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(3));
}

function normalizedValues(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function overlapScore(left: string[] | undefined, right: string[] | undefined): number {
  const leftValues = new Set(normalizedValues(left));
  const rightValues = normalizedValues(right);
  if (rightValues.length === 0) return leftValues.size > 0 ? 0.6 : 0.35;
  const matched = rightValues.filter((value) => leftValues.has(value)).length;
  return matched / rightValues.length;
}

function stableConfidence(output: CandidateEvaluation): number {
  const scores = Object.values(output.axes).map((axis) => axis.score);
  return boundedScore(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function evaluateCandidate(
  candidate: CandidateInput,
  request: BusinessDiagnosisRequest,
): CandidateEvaluation {
  const position = request.input.position ?? {
    title: 'Unspecified position',
    responsibilities: [],
    requiredCapabilities: [],
    successCriteria: [],
  };
  const business = request.input.business;
  const requiredCapabilities = position.requiredCapabilities ?? position.responsibilities;
  const capabilityFit: AxisEvaluation = {
    score: boundedScore(overlapScore(candidate.skills, requiredCapabilities)),
    evidence:
      candidate.skills && candidate.skills.length > 0
        ? [`Candidate supplied ${candidate.skills.length} skill(s).`]
        : ['No structured skill evidence was supplied.'],
  };
  const experienceFit: AxisEvaluation = {
    score: boundedScore(overlapScore(candidate.experience, position.responsibilities)),
    evidence:
      candidate.experience && candidate.experience.length > 0
        ? [`Candidate supplied ${candidate.experience.length} experience item(s).`]
        : ['No structured experience evidence was supplied.'],
  };
  const contextMatches =
    business?.industry && candidate.industry
      ? business.industry.toLowerCase() === candidate.industry.toLowerCase()
        ? 1
        : 0.35
      : 0.4;
  const contextFit: AxisEvaluation = {
    score: boundedScore(contextMatches),
    evidence:
      business?.industry && candidate.industry
        ? [`Industry context compared: ${candidate.industry} vs ${business.industry}.`]
        : ['Business or candidate industry context is incomplete.'],
  };
  const motivationFit: AxisEvaluation = {
    score: boundedScore(
      candidate.motivation && candidate.motivation.length > 0
        ? overlapScore(candidate.motivation, position.successCriteria)
        : 0.35,
    ),
    evidence:
      candidate.motivation && candidate.motivation.length > 0
        ? ['Structured motivation evidence was supplied.']
        : ['Motivation evidence is missing.'],
  };
  const missingEvidence: string[] = [];
  if (!candidate.skills?.length) missingEvidence.push('skills');
  if (!candidate.experience?.length) missingEvidence.push('experience');
  if (!candidate.motivation?.length) missingEvidence.push('motivation');
  const riskAndReadiness: AxisEvaluation = {
    score: boundedScore(1 - Math.min(0.8, missingEvidence.length * 0.2)),
    evidence: [
      missingEvidence.length === 0
        ? 'Required structured evidence is present.'
        : `Missing evidence fields: ${missingEvidence.join(', ')}.`,
    ],
  };
  const result: CandidateEvaluation = {
    candidateId: candidate.id,
    axes: {
      capabilityFit,
      experienceFit,
      contextFit,
      motivationFit,
      riskAndReadiness,
    },
    overallAssessment: `${candidate.name ?? candidate.id} evaluated against ${position.title}.`,
    confidence: 0,
    missingEvidence,
    recommendation: 'Review evidence and validate the strongest gaps before a final decision.',
  };
  result.confidence = stableConfidence(result);
  if (result.confidence >= 0.75) {
    result.recommendation = 'Prioritize for structured follow-up based on the available evidence.';
  } else if (result.confidence < 0.5) {
    result.recommendation = 'Request additional evidence before relying on this assessment.';
  }
  return result;
}

export function diagnoseBusiness(input: BusinessDiagnosisRequest): DiagnosisOutput {
  const position = input.input.position ?? {
    title: 'Unspecified position',
    responsibilities: [],
    requiredCapabilities: [],
    successCriteria: [],
  };
  const candidates = input.input.candidates ?? [];
  const limitations = [
    'This deterministic MVP worker uses only submitted structured evidence.',
    'Scores are decision support and require human review; they are not an automated hiring decision.',
  ];
  if (candidates.length === 0) {
    limitations.push('No candidate profiles were supplied for comparison.');
  }
  return {
    schemaVersion: 'business-diagnosis.v1',
    jobProfile: {
      title: position.title,
      responsibilities: position.responsibilities,
      requiredCapabilities: position.requiredCapabilities ?? position.responsibilities,
      successCriteria: position.successCriteria ?? [],
    },
    candidateEvaluations: candidates.map((candidate) => evaluateCandidate(candidate, input)),
    limitations,
    generatedAt: new Date().toISOString(),
  };
}

/** Compatibility helper for the initial worker contract. */
export function diagnose(input: DiagnosisInput): DiagnosisOutput {
  return diagnoseBusiness({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    workItemId: input.processRunId,
    processRunId: input.processRunId,
    input: {
      position: {
        title: 'Business diagnosis',
        responsibilities: Object.keys(input.answers),
        requiredCapabilities: Object.keys(input.answers),
      },
      candidates: [
        {
          id: 'submitted-profile',
          skills: Object.keys(input.answers),
          experience: Object.keys(input.answers),
        },
      ],
    },
  });
}

export function buildStartedEvent(input: DiagnosisInput) {
  return runtimeEventSchema.parse({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    processRunId: input.processRunId,
    type: 'diagnosis.started',
    payload: { schemaVersion: 'business-diagnosis.v1' },
    idempotencyKey: `diagnosis-started-${input.processRunId}`,
  });
}

export function buildCompletedEvent(input: DiagnosisInput, output: DiagnosisOutput) {
  return runtimeEventSchema.parse({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    processRunId: input.processRunId,
    type: 'diagnosis.completed',
    payload: output,
    idempotencyKey: `diagnosis-completed-${input.processRunId}`,
  });
}

export function buildSemanticRecordProposal(
  input: BusinessDiagnosisRequest,
  output: DiagnosisOutput,
) {
  const payload = {
    schemaVersion: output.schemaVersion,
    jobProfile: output.jobProfile,
    candidateEvaluations: output.candidateEvaluations,
    limitations: output.limitations,
  };
  return createSemanticRecordSchema.parse({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    workItemId: input.workItemId,
    processRunId: input.processRunId,
    type: 'diagnostic_observation',
    title: `Business diagnosis: ${output.jobProfile.title}`,
    summary: `Deterministic five-axis evaluation completed for ${output.jobProfile.title}.`,
    payload,
    provenance: {
      sourceType: 'process_run',
      sourceId: input.processRunId,
      actorId: input.actorId,
    },
  });
}

export function buildClaimProposal(
  input: BusinessDiagnosisRequest,
  output: DiagnosisOutput,
  semanticRecordId: string,
) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(output))
    .digest('hex')
    .slice(0, 16);
  return createKnowledgeClaimSchema.parse({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    semanticRecordId,
    processRunId: input.processRunId,
    subject: `diagnosis:${output.jobProfile.title}`,
    claimType: 'verified_fact',
    content: {
      fingerprint,
      summary: output.candidateEvaluations.map((evaluation) => ({
        candidateId: evaluation.candidateId,
        confidence: evaluation.confidence,
        recommendation: evaluation.recommendation,
      })),
    },
    evidence: [semanticRecordId],
    confidence:
      output.candidateEvaluations.length > 0
        ? boundedScore(
            output.candidateEvaluations.reduce(
              (sum, evaluation) => sum + evaluation.confidence,
              0,
            ) / output.candidateEvaluations.length,
          )
        : null,
  });
}
