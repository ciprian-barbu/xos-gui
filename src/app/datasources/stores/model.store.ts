/// <reference path="../../../../typings/index.d.ts"/>
import * as _ from 'lodash';
import {BehaviorSubject, Observable} from 'rxjs/Rx';
import {IWSEvent, IWSEventService} from '../websocket/global';
import {IXosResourceService} from '../rest/model.rest';
import {IStoreHelpersService} from '../helpers/store.helpers';

export interface  IXosModelStoreService {
  query(model: string): Observable<any>;
  search(modelName: string): any[];
}

export class ModelStore implements IXosModelStoreService {
  static $inject = ['$log', 'WebSocket', 'StoreHelpers', 'ModelRest'];
  private _collections: any; // NOTE contains a map of {model: BehaviourSubject}
  constructor(
    private $log: ng.ILogService,
    private webSocket: IWSEventService,
    private storeHelpers: IStoreHelpersService,
    private ModelRest: IXosResourceService,
  ) {
    this._collections = {};
  }

  public query(model: string): Observable<any> {
    // if there isn't already an observable for that item
    if (!this._collections[model]) {
      this._collections[model] = new BehaviorSubject([]); // NOTE maybe this can be created when we get response from the resource
      this.loadInitialData(model);
    }

    this.webSocket.list()
      .filter((e: IWSEvent) => e.model === model)
      .subscribe(
        (event: IWSEvent) => {
          this.storeHelpers.updateCollection(event, this._collections[model]);
        },
        err => console.error
      );

    return this._collections[model].asObservable();
  }

  public search(modelName: string): any[] {
    return _.reduce(Object.keys(this._collections), (results, k) => {
      // console.log(k, this._collections[k].value)
      const partialRes = _.filter(this._collections[k].value, i => {
        if (i.humanReadableName) {
          return i.humanReadableName.toLowerCase().indexOf(modelName) > -1;
        }
        else if (i.name) {
          return i.name.toLowerCase().indexOf(modelName) > -1;
        }
        return false;
      })
        .map(m => {
          m.modelName = k;
          return m;
        });
      return results.concat(partialRes);
    }, []);
  }

  public get(model: string, id: number) {
    // TODO implement a get method
  }

  private loadInitialData(model: string) {
    // NOTE check what is the correct pattern to pluralize this
    const endpoint = this.storeHelpers.urlFromCoreModel(model);
    this.ModelRest.getResource(endpoint).query().$promise
      .then(
        res => {
          this._collections[model].next(res);
        })
      .catch(
        err => this.$log.log(`Error retrieving ${model}`, err)
      );
  }
}
