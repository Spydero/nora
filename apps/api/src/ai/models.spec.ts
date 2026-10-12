import { geminiSchema, prepareGeminiBody, rememberSignatures } from './models.js';

describe('Gemini request shaping', () => {
  it('drops array and string length keywords Gemini rejects, but keeps properties with those names', () => {
    const schema = {
      type: 'object',
      properties: {
        items: { type: 'array', maxItems: 40, minItems: 1, items: { type: 'string', maxLength: 300, pattern: '^a' } },
        pattern: { type: 'string' },
      },
    };
    expect(geminiSchema(schema)).toEqual({
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'string' } }, pattern: { type: 'string' } },
    });
  });

  it('returns the thought signature Gemini gave for a tool call', () => {
    rememberSignatures({
      choices: [{ message: { tool_calls: [{ id: 'call_1', function: { name: 'search', arguments: '{"query":"sore throat"}' }, extra_content: { google: { thought_signature: 'sig-1' } } }] } }],
    });
    const body = prepareGeminiBody({
      messages: [
        { role: 'user' },
        { role: 'assistant', tool_calls: [{ id: 'call_1', function: { name: 'search', arguments: '{ "query": "sore throat" }' } }] },
      ],
    });
    expect(body.messages![1]!.tool_calls![0]!.extra_content?.google?.thought_signature).toBe('sig-1');
  });

  it('uses the documented bypass for a call it never saw', () => {
    const body = prepareGeminiBody({ messages: [{ role: 'assistant', tool_calls: [{ id: 'call_9', function: { name: 'other', arguments: '{}' } }] }] });
    expect(body.messages![0]!.tool_calls![0]!.extra_content?.google?.thought_signature).toBe('skip_thought_signature_validator');
  });
});
