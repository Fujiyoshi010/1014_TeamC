/** 要件3: 繰り上がり通知メール。Hono 側はこのIFにだけ依存する。 */
export interface PromotionMail {
  to: string;
  name: string;
  eventId: string;
  eventName: string;
}

export interface Mailer {
  sendPromotion(mail: PromotionMail): Promise<void>;
}

/** 開発・テスト用の既定実装: 送信履歴を保持しコンソールに出す */
export class InMemoryMailer implements Mailer {
  sent: PromotionMail[] = [];
  async sendPromotion(mail: PromotionMail): Promise<void> {
    this.sent.push(mail);
    console.log(
      `[mail] to=${mail.to} event=${mail.eventName}(${mail.eventId}) ${mail.name}様が繰り上がりました`,
    );
  }
}

/** 本番差し替え例: SMTP / Resend / SES 等を使う場合はこのIFを実装する */
export type MailerFactory = () => Mailer;
