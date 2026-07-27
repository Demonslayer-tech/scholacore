// @paystack/inline-js ships no type declarations. This is a minimal ambient
// shim for the surface this project actually uses — see Paystack's Inline
// JS docs for the full API if you extend usage beyond resumeTransaction.
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
