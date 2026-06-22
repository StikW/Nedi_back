import { Injectable } from '@nestjs/common';
import { MetaMessagesService } from './meta-messages.service';
import { MetaContactsService } from './meta-contacts.service';

export interface MetaConversationSummary {
  id: string;
  contactName: string;
  phone: string;
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
}

@Injectable()
export class MetaConversationsService {
  constructor(
    private readonly messagesService: MetaMessagesService,
    private readonly contactsService: MetaContactsService,
  ) {}

  async listConversations(): Promise<MetaConversationSummary[]> {
    const messages = await this.messagesService.findAll();
    if (messages.length === 0) return [];

    let contacts: Awaited<ReturnType<MetaContactsService['findAll']>> = [];
    try {
      contacts = await this.contactsService.findAll();
    } catch {
      contacts = [];
    }

    const byPhone = new Map<string, MetaConversationSummary>();

    for (const msg of messages) {
      const phone = this.messagesService.normalizePhone(msg.phone);
      const existing = byPhone.get(phone);
      if (!existing || msg.timestamp > existing.lastMessageAt) {
        const contact = contacts.find(
          (c) => this.messagesService.normalizePhone(c.phone) === phone,
        );
        byPhone.set(phone, {
          id: phone,
          phone,
          contactName: contact?.name || msg.contactName || phone,
          lastMessage: msg.body,
          lastMessageAt: msg.timestamp,
          unread: 0,
        });
      }
    }

    return Array.from(byPhone.values()).sort((a, b) =>
      b.lastMessageAt.localeCompare(a.lastMessageAt),
    );
  }

  async getMessages(conversationId: string) {
    const messages = await this.messagesService.findByPhone(conversationId);
    return {
      conversationId,
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        timestamp: m.timestamp,
      })),
    };
  }
}
