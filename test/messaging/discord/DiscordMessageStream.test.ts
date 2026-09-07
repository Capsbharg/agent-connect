import { describe, expect, it, vi } from 'vitest';
import { DiscordMessageStream } from '../../../src/messaging/discord/DiscordMessageStream.js';
import { createTestLogger } from '../../helpers/testLogger.js';

function fakeMessage(text: string) {
  return { id: 'm1', content: text, edit: vi.fn(async () => {}) };
}

function fakeSendableChannel() {
  return { isSendable: () => true, send: vi.fn(async (text: string) => fakeMessage(text)) };
}

function fakeClient(channel: unknown) {
  return { channels: { fetch: vi.fn(async () => channel) } };
}

describe('DiscordMessageStream', () => {
  it('post() fetches the channel once and sends the first message', async () => {
    const channel = fakeSendableChannel();
    const client = fakeClient(channel);
    const stream = new DiscordMessageStream({
      client: client as never,
      channelId: 'C1',
      editThrottleMs: 1500,
      logger: createTestLogger(),
    });

    await stream.post({ text: 'hello' });

    expect(client.channels.fetch).toHaveBeenCalledWith('C1');
    expect(channel.send).toHaveBeenCalledWith('hello');
  });

  it('complete() edits the message post() created, without re-fetching the channel', async () => {
    const channel = fakeSendableChannel();
    const client = fakeClient(channel);
    const stream = new DiscordMessageStream({
      client: client as never,
      channelId: 'C1',
      editThrottleMs: 1500,
      logger: createTestLogger(),
    });

    await stream.post({ text: 'starting' });
    const sentMessage = await channel.send.mock.results[0]!.value;
    await stream.complete({ text: 'done' });

    expect(sentMessage.edit).toHaveBeenCalledWith('done');
    expect(client.channels.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not re-edit with identical content (avoids a pointless API call)', async () => {
    const channel = fakeSendableChannel();
    const client = fakeClient(channel);
    const stream = new DiscordMessageStream({
      client: client as never,
      channelId: 'C1',
      editThrottleMs: 0,
      logger: createTestLogger(),
    });

    await stream.post({ text: 'same' });
    const sentMessage = await channel.send.mock.results[0]!.value;
    await stream.update({ text: 'same' });

    expect(sentMessage.edit).not.toHaveBeenCalled();
  });

  it('clamps content over the 2000-character Discord message limit', async () => {
    const channel = fakeSendableChannel();
    const client = fakeClient(channel);
    const stream = new DiscordMessageStream({
      client: client as never,
      channelId: 'C1',
      editThrottleMs: 1500,
      logger: createTestLogger(),
    });

    await stream.post({ text: 'x'.repeat(3000) });

    const sentText = channel.send.mock.calls[0]![0] as string;
    expect(sentText.length).toBeLessThanOrEqual(2000);
    expect(sentText).toContain('(truncated)');
  });

  it('logs an error instead of throwing when the channel is missing or not sendable', async () => {
    const logger = createTestLogger();
    const client = fakeClient(null);
    const stream = new DiscordMessageStream({
      client: client as never,
      channelId: 'C1',
      editThrottleMs: 1500,
      logger,
    });

    await expect(stream.post({ text: 'hello' })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      'Discord channel is missing or cannot receive messages',
      { channelId: 'C1' },
    );
  });

  it('an edit before post() (no message yet) is a safe no-op', async () => {
    const channel = fakeSendableChannel();
    const client = fakeClient(channel);
    const stream = new DiscordMessageStream({
      client: client as never,
      channelId: 'C1',
      editThrottleMs: 1500,
      logger: createTestLogger(),
    });

    await expect(stream.complete({ text: 'too soon' })).resolves.toBeUndefined();
  });
});
