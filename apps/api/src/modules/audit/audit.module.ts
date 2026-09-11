import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Global: nearly every mutating module writes audit rows. */
@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
