import { DEFAULT_BLUEPRINT } from './blueprint';
import { exportSessionRecord } from './exporters';
import { prepareRecoverySession } from './recovery';
import { loadRecoveryEvents, loadRecoverySnapshot } from './storage';

export async function exportIncompleteRecovery(sessionId: string): Promise<string> {
  const [raw, events] = await Promise.all([
    loadRecoverySnapshot(sessionId),
    loadRecoveryEvents(sessionId)
  ]);
  const prepared = prepareRecoverySession(raw, [DEFAULT_BLUEPRINT.blueprint_id]);
  if (!prepared.ok) throw new Error(`${prepared.code}: ${prepared.diagnostic}`);
  return exportSessionRecord(prepared.session, events);
}
