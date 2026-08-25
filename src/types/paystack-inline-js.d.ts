declare module '@paystack/inline-js' {
  interface PaystackTransaction {
    reference: string;
    status: string;
    trans: string;
    message: string;
    trxref: string;
  }

  interface ResumeTransactionOptions {
    onSuccess?: (transaction: PaystackTransaction) => void;
    onCancel?: () => void;
    onError?: (error: unknown) => void;
  }

  export default class PaystackPop {
    resumeTransaction(accessCode: string, options?: ResumeTransactionOptions): void;
  }
}
