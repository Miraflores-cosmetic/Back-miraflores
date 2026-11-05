import { BadRequestException } from '@nestjs/common';
import {
  sampleCartRejectionMessage,
  type SampleCartRemovalReason,
} from './sample-purchase.util';

export type SamplePurchaseErrorCode =
  | 'sample_guest'
  | 'sample_already_purchased'
  | 'sample_qty_limit';

export class SamplePurchaseRejectedException extends BadRequestException {
  constructor(
    public readonly code: SamplePurchaseErrorCode,
    message?: string,
  ) {
    super({
      statusCode: 400,
      code,
      message: message ?? samplePurchaseErrorMessage(code),
    });
  }
}

export function samplePurchaseErrorMessage(
  code: SamplePurchaseErrorCode,
): string {
  if (code === 'sample_guest') {
    return sampleCartRejectionMessage('sample_guest');
  }
  if (code === 'sample_already_purchased') {
    return sampleCartRejectionMessage('sample_already_purchased');
  }
  return 'Пробник можно заказать только в количестве 1';
}

export function sampleCartRemovalToErrorCode(
  reason: SampleCartRemovalReason,
): SamplePurchaseErrorCode {
  return reason === 'sample_guest' ? 'sample_guest' : 'sample_already_purchased';
}

export function throwIfSampleCartBlocked(
  removedLines: Array<{ reason?: string }> | undefined,
): void {
  if (!removedLines?.length) return;
  for (const line of removedLines) {
    if (line.reason === 'sample_guest' || line.reason === 'sample_already_purchased') {
      throw new SamplePurchaseRejectedException(
        sampleCartRemovalToErrorCode(line.reason),
      );
    }
  }
}
