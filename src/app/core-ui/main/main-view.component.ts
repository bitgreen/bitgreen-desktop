import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { Log } from 'ng2-logger';
import { MatDialog } from '@angular/material';
import { Observable } from 'rxjs/Observable';


import { environment } from '../../../environments/environment';

import {BlockStatusService, RpcService, RpcStateService} from '../../core/core.module';
import { NewTxNotifierService } from 'app/core/rpc/rpc.module';
import { UpdaterService } from 'app/core/updater/updater.service';
import { ModalsHelperService } from 'app/modals/modals.module';
import {ConsoleModalComponent} from "./status/modal/help-modal/console-modal.component";

/*
 * The MainView is basically:
 * sidebar + router-outlet.
 * Will display the _main_ sidebar (not wallet picker)
 * and display wallet + market views.
 */
@Component({
  selector: 'app-main-view',
  templateUrl: './main-view.component.html',
  styleUrls: ['./main-view.component.scss']
})
export class MainViewComponent implements OnInit, OnDestroy {

  log: any = Log.create('main-view.component');
  private destroyed: boolean = false;
  public syncPercentage: number = 0;

  /* ui state */
  public initialized: boolean = false; // hide if no progress has been retrieved yet

  public syncString: string;

  /* UI States */

  title: string = '';
  testnet: boolean = false;
  checked = false;
  peerListCount: number = 0;
  /* errors */
  walletInitialized: boolean = undefined;
  daemonRunning: boolean = undefined;
  daemonError: any;
  /* version */
  daemonVersion: string;
  clientVersion: string = environment.version;
  unSubscribeTimer: any;
  time: string = '5:00';
  public unlocked_until: number = 0;

  constructor(
    private _router: Router,
    private _route: ActivatedRoute,
    private _rpc: RpcService,
    private _updater: UpdaterService,
    private _rpcState: RpcStateService,
    private _modalsService: ModalsHelperService,
    private dialog: MatDialog,
    // the following imports are just 'hooks' to
    // get the singleton up and running
    private _newtxnotifier: NewTxNotifierService,
    private _blockStatusService: BlockStatusService
  ) { }

  ngOnInit() {
    // Change the header title derived from route data
    // Source: https://toddmotto.com/dynamic-page-titles-angular-2-router-events
    this._router.events
      .filter(event => event instanceof NavigationEnd)
      .map(() => this._route)
      .map(route => {
        while (route.firstChild) {
          route = route.firstChild;
        }
        return route;
      })
      .filter(route => route.outlet === 'primary')
      .flatMap(route => route.data)
      .subscribe(data => this.title = data['title']);


    /* errors */
    // Updates the error box in the sidenav whenever a stateCall returns an error.
    this._rpcState.errorsStateCall.asObservable()
      .distinctUntilChanged()
      .subscribe(update => {
        // if error exists & != false
        if (update.error) {
          this.daemonRunning = ![0, 502].includes(update.error.status);
          this.daemonError = update.error;
          this.log.d(update.error);
        } else {
          this.daemonRunning = true;
        }
      });

    // Updates the error box in the sidenav if wallet is not initialized.
    this._rpcState.observe('ui:walletInitialized')
      .takeWhile(() => !this.destroyed)
      .subscribe(status => this.walletInitialized = status);


    this._rpcState.observe('getwalletinfo', 'unlocked_until')
      .takeWhile(() => !this.destroyed)
      .subscribe(status => {
        this.unlocked_until = status;
        if (this.unlocked_until > 0) {
          this.checkTimeDiff(status);
        } else {
          if (this.unSubscribeTimer) {
            this.unSubscribeTimer.unsubscribe();
          }
        }
      });

    /* versions */
    // Obtains the current daemon version
    this._rpcState.observe('getnetworkinfo', 'subversion')
      .takeWhile(() => !this.destroyed)
      .subscribe(subversion => this.daemonVersion = subversion.match(/\d+\.\d+.\d+.\d+/)[0]);

    /* check if testnet -> block explorer url */
    this._rpcState.observe('getblockchaininfo', 'chain').take(1)
      .subscribe(chain => this.testnet = chain === 'test');

    this._blockStatusService.statusUpdates.asObservable().subscribe(status => {
      this.log.d(`updating percentage-bar`);
      this.updateProgress(status.syncPercentage);
    });

    this._rpcState.observe('getnetworkinfo', 'connections')
      .takeWhile(() => !this.destroyed)
      .subscribe(connections => this.peerListCount = connections);

  }

  ngOnDestroy() {
    this.destroyed = true;
  }
  /** Open createwallet modal when clicking on error in sidenav */
  createWallet() {
    this._modalsService.createWallet();
  }

  getIconNumber(): number {
    if (this.peerListCount >= 16) {
      return 100;
    } else if (this.peerListCount < 16) {
      return this.peerListCount * 6.25;
    } else {
      return 0;
    }
  }

  /** Open syncingdialog modal when clicking on progresbar in sidenav */
  syncScreen() {
    this._modalsService.syncing();
  }

  checkTimeDiff(time: number) {
    const currentUtcTimeStamp = Math.floor((new Date()).getTime() / 1000);
    const diff = Math.floor(time - currentUtcTimeStamp);
    const minutes = Math.floor((diff % (60 * 60)) / 60);
    const sec = Math.ceil((diff % (60 * 60) % 60));
    this.startTimer(minutes, sec);
  }

  startTimer(min: number, sec: number): void {
    sec = this.checkSecond(sec);
    if (sec === 59) {
      min = min - 1;
    }
    if (min >= 0 && sec >= 0) {
      this.time = min + ':' + ('0' + sec).slice(-2);
      this.unSubscribeTimer = Observable.timer(1000).
        subscribe(() => this.startTimer(min, sec));
    } else {
      this.unSubscribeTimer.unsubscribe();
    }
  }

  checkSecond(sec: number): number {
    sec = sec > 0 ? (sec - 1) : 59;
    return sec;
  }

  // Paste Event Handle
  @HostListener('window:keydown', ['$event'])
  keyDownEvent(event: any) {
    if (event.metaKey && event.keyCode === 86 && navigator.platform.indexOf('Mac') > -1) {
      document.execCommand('Paste');
      event.preventDefault();
    }
  }

  /**
   * Update sync progress
   * @param {number} number  The sync percentage
   */
  // @TODO create sparate component to display process
  updateProgress(progress: number): void {
    this.log.d('updateProgress', progress);
    this.initialized = true;
    this.syncPercentage = progress;
    this.syncString = progress === 100
      ? 'Fully synced'
      : `${progress.toFixed(2)} %`
  }

  /* Open Debug Console Window */
  openConsoleWindow() {
    this.dialog.open(ConsoleModalComponent);
  }

}
