import { Logger } from "@matter/main";

export class ConsoleLogger {
    private logs: string[] = [];
    private originalLog = console.log;
    private originalInfo = console.info;
    private originalWarn = console.warn;
    private originalError = console.error;

    public start() {
        console.log = (message: any, ...optionalParams: any[]) => {
            if (typeof message === 'string' && message.includes('QR code URL:')) {
                // Do not call originalLog to suppress output
            } else {
                const logMessage = `[LOG] ${message} ${optionalParams.join(' ')}`;
                this.logs.push(logMessage);
            }
        };
        console.info = (message: any, ...optionalParams: any[]) => {
            const logMessage = `[INFO] ${message} ${optionalParams.join(' ')}`;
            this.logs.push(logMessage);
        };
        console.warn = (message: any, ...optionalParams: any[]) => {
            const logMessage = `[WARN] ${message} ${optionalParams.join(' ')}`;
            this.logs.push(logMessage);
        };
        console.error = (message: any, ...optionalParams: any[]) => {
            const logMessage = `[ERROR] ${message} ${optionalParams.join(' ')}`;
            this.logs.push(logMessage);
        };
    }

    public stop() {
        console.log = this.originalLog;
        console.info = this.originalInfo;
        console.warn = this.originalWarn;
        console.error = this.originalError;
    }

    public getLogs(): string[] {
        return this.logs;
    }

    public getQrCode(): string | null {
        const qrCodeLog = this.logs.find(log => log.includes('QR code URL:'));
        if (qrCodeLog) {
            const match = qrCodeLog.match(/data=([^\s]+)/);
            if (match) {
                return match[1];
            }
        }
        return null;
    }
}