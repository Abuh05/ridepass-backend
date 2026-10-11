export type Button = { id: string; title: string };
export type OutMsg = { text: string; buttons?: Button[]; audioKey?: string; template?: { name: string; params: string[]; buttonPayloads?: string[] } };
export type Inbound = {
  channel: 'whatsapp' | 'web';
  from: string;                 // phone
  externalId?: string;          // WhatsApp message id (idempotency)
  kind: 'text' | 'audio' | 'button';
  text?: string;
  buttonId?: string;
  waMediaId?: string;           // WhatsApp audio
  audioPath?: string;           // web audio saved to disk
  mime?: string;
  mockTranscript?: string;      // mock mode / simulation only
  agentId?: string;             // recorded by a field agent
  profileName?: string;
};
