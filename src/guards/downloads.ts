import { BaseGuard, GuardContext } from './base-guard';

export class DownloadGuard extends BaseGuard {
  readonly name = 'downloads';
  readonly priority = 45;

  private downloadsPath?: string;

  constructor(downloadsPath?: string) {
    super();
    this.downloadsPath = downloadsPath;
  }

  protected async onAttach(ctx: GuardContext): Promise<void> {
    ctx.page.on('download', async (download) => {
      this.logger.debug(`Download started: ${download.suggestedFilename()}`);
      ctx.events.emit('download', {
        filename: download.suggestedFilename(),
        url: download.url(),
      });

      if (this.downloadsPath) {
        const savePath = `${this.downloadsPath}/${download.suggestedFilename()}`;
        await download.saveAs(savePath);
        this.logger.debug(`Download saved to: ${savePath}`);
      }
    });
  }

  protected async onDetach(): Promise<void> {}
}
