import nodemailer from 'nodemailer';
import type { Notifier } from '../../app/ports';
import type { Customer, Invoice } from '../../domain';

export class SmtpNotifier implements Notifier {
  private readonly transport;

  constructor(host: string, private readonly from: string) {
    this.transport = nodemailer.createTransport({ host, port: 587 });
  }

  async invoiceIssued(customer: Customer, invoice: Invoice): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: customer.email,
      subject: `Invoice ${invoice.number}`,
      text: `Amount due: ${(invoice.amount.cents / 100).toFixed(2)} ${invoice.amount.currency}`,
    });
  }
}
