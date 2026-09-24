import { SetMetadata } from '@nestjs/common';

export const SKIP_RLS_TRANSACTION_KEY = 'skipRlsTransaction';

/** Do not hold an RLS transaction for the whole request (e.g. multer body read). */
export const SkipRlsTransaction = () => SetMetadata(SKIP_RLS_TRANSACTION_KEY, true);
