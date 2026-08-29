import { describe, expect, it } from 'vitest';
import {
  buildClaimProposal,
  buildCompletedEvent,
  buildSemanticRecordProposal,
  buildStartedEvent,
  diagnoseBusiness,
  type BusinessDiagnosisRequest,
} from './index.js';

const ids = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  actorId: '00000000-0000-4000-8000-000000000003',
  workItemId: '00000000-0000-4000-8000-000000000004',
  processRunId: '00000000-0000-4000-8000-000000000005',
  semanticRecordId: '00000000-0000-4000-8000-000000000006',
};

const request: BusinessDiagnosisRequest = {
  ...ids,
  input: {
    business: { industry: 'technology', size: 'small' },
    position: {
      title: 'Operations Lead',
      responsibilities: ['operations', 'process ownership'],
      requiredCapabilities: ['operations'],
      successCriteria: ['process ownership'],
    },
    candidates: [
      {
        id: 'candidate-1',
        name: 'Candidate One',
        skills: ['operations'],
        experience: ['operations'],
        industry: 'technology',
        motivation: ['process ownership'],
      },
    ],
  },
};

describe('native diagnosis worker', () => {
  it('produces a structured five-axis diagnosis', () => {
    const output = diagnoseBusiness(request);
    const evaluation = output.candidateEvaluations[0];

    expect(output.schemaVersion).toBe('business-diagnosis.v1');
    expect(output.jobProfile.title).toBe('Operations Lead');
    expect(evaluation?.axes).toEqual(
      expect.objectContaining({
        capabilityFit: expect.any(Object),
        experienceFit: expect.any(Object),
        contextFit: expect.any(Object),
        motivationFit: expect.any(Object),
        riskAndReadiness: expect.any(Object),
      }),
    );
    expect(evaluation?.confidence).toBeGreaterThan(0.75);
    expect(evaluation?.missingEvidence).toEqual([]);
  });

  it('emits versioned runtime events', () => {
    const started = buildStartedEvent({ ...ids, answers: { industry: 'technology' } });
    const completed = buildCompletedEvent(
      { ...ids, answers: { industry: 'technology' } },
      diagnoseBusiness(request),
    );

    expect(started.type).toBe('diagnosis.started');
    expect(completed.type).toBe('diagnosis.completed');
    expect(started.idempotencyKey).toContain(ids.processRunId);
  });

  it('builds governed record and claim proposals without writing persistence', () => {
    const output = diagnoseBusiness(request);
    const record = buildSemanticRecordProposal(request, output);
    const claim = buildClaimProposal(request, output, ids.semanticRecordId);

    expect(record.workItemId).toBe(ids.workItemId);
    expect(record.processRunId).toBe(ids.processRunId);
    expect(claim.semanticRecordId).toBe(ids.semanticRecordId);
    expect(claim.evidence).toEqual([ids.semanticRecordId]);
  });
});
