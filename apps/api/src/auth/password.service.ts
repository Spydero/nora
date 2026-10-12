import { Injectable, type OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';

const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash = '';

  async onModuleInit() {
    this.dummyHash = await argon2.hash('nora-timing-equaliser', OPTIONS);
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    try {
      // Verify against a dummy hash when the account is unknown so response time does not reveal it.
      const ok = await argon2.verify(hash ?? this.dummyHash, password);
      return Boolean(hash) && ok;
    } catch {
      return false;
    }
  }
}
