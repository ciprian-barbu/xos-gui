import * as _ from 'lodash';
import {Observable, BehaviorSubject, Subscription} from 'rxjs';
import {IXosModelStoreService} from '../../datasources/stores/model.store';
import {
  IXosServiceGraph, IXosServiceModel, IXosTenantModel, IXosCoarseGraphData,
  IXosServiceGraphNode, IXosServiceGraphLink, IXosFineGrainedGraphData
} from '../interfaces';
import {IXosDebouncer} from '../../core/services/helpers/debounce.helper';
export interface IXosServiceGraphStore {
  get(): Observable<IXosServiceGraph>;
  getCoarse(): Observable<IXosServiceGraph>;
}

export class XosServiceGraphStore implements IXosServiceGraphStore {
  static $inject = [
    '$log',
    'XosModelStore',
    'XosDebouncer'
  ];

  // graph data store
  private graphData: BehaviorSubject<IXosFineGrainedGraphData> = new BehaviorSubject({
    services: [],
    tenants: [],
    networks: [],
    subscribers: [],
    servicedependencys: []
  });

  private emptyGraph: IXosServiceGraph = {
    nodes: [],
    links: []
  };

  // representation of the graph as D3 requires
  private d3CoarseGraph = new BehaviorSubject(this.emptyGraph);
  private d3FineGrainedGraph = new BehaviorSubject(this.emptyGraph);

  // storing locally reference to the data model
  private services;
  private tenants;
  private subscribers;
  private networks;
  private servicedependencys;

  // debounced functions
  private handleData;

  // datastore
  private ServiceSubscription: Subscription;
  private TenantSubscription: Subscription;
  private SubscriberSubscription: Subscription;
  private NetworkSubscription: Subscription;
  private ServiceDependencySubscription: Subscription;

  constructor (
    private $log: ng.ILogService,
    private XosModelStore: IXosModelStoreService,
    private XosDebouncer: IXosDebouncer
  ) {

    this.$log.info(`[XosServiceGraphStore] Setup`);

    // we want to have a quiet period of 500ms from the last event before doing anything
    this.handleData = this.XosDebouncer.debounce(this._handleData, 500, this, false);

    // observe models and populate graphData
    this.ServiceSubscription = this.XosModelStore.query('Service', '/core/services')
      .subscribe(
        (res) => {
          this.combineData(res, 'services');
        },
        (err) => {
          this.$log.error(`[XosServiceGraphStore] Service Observable: `, err);
        }
      );

    this.ServiceDependencySubscription = this.XosModelStore.query('ServiceDependency', '/core/servicedependencys')
      .subscribe(
        (res) => {
          this.combineData(res, 'servicedependencys');
        },
        (err) => {
          this.$log.error(`[XosServiceGraphStore] Service Observable: `, err);
        }
      );

    this.TenantSubscription = this.XosModelStore.query('Tenant', '/core/tenants')
      .subscribe(
        (res) => {
          this.combineData(res, 'tenants');
        },
        (err) => {
          this.$log.error(`[XosServiceGraphStore] Tenant Observable: `, err);
        }
      );

    this.SubscriberSubscription = this.XosModelStore.query('Tenantroot', '/core/tenantroots')
      .subscribe(
        (res) => {
          this.combineData(res, 'subscribers');
        },
        (err) => {
          this.$log.error(`[XosServiceGraphStore] Subscriber Observable: `, err);
        }
      );

    this.NetworkSubscription = this.XosModelStore.query('Network', '/core/networks')
      .subscribe(
        (res) => {
          this.combineData(res, 'networks');
        },
        (err) => {
          this.$log.error(`[XosServiceGraphStore] graphData Observable: `, err);
        }
      );

    // observe graphData and build Coarse and FineGrained graphs
    this.graphData
      .subscribe(
        (res: IXosFineGrainedGraphData) => {
          this.$log.debug(`[XosServiceGraphStore] New graph data received`, res);
          this.graphDataToCoarseGraph(res);
          this.graphDataToFineGrainedGraph(res);
        },
        (err) => {
          this.$log.error(`[XosServiceGraphStore] graphData Observable: `, err);
        }
      );
  }

  public get() {
    return this.d3FineGrainedGraph.asObservable();
  }

  public getCoarse() {
    return this.d3CoarseGraph.asObservable();
  }

  private combineData(data: any, type: 'services'|'tenants'|'subscribers'|'networks'|'servicedependencys') {
    switch (type) {
      case 'services':
        this.services = data;
        break;
      case 'tenants':
        this.tenants = data;
        break;
      case 'subscribers':
        this.subscribers = data;
        break;
      case 'networks':
        this.networks = data;
        break;
      case 'servicedependencys':
        this.servicedependencys = data;
        break;
    }
    this.handleData(this.services, this.tenants);
  }

  private _handleData(services: IXosServiceModel[], tenants: IXosTenantModel[]) {
    this.graphData.next({
      services: this.services,
      tenants: this.tenants,
      subscribers: this.subscribers,
      networks: this.networks,
      servicedependencys: this.servicedependencys
    });
  }

  private getNodeIndexById(id: number | string, nodes: IXosServiceModel[]) {
    return _.findIndex(nodes, {id: id});
  }

  private d3Id(type: string, id: number) {
    return `${type.toLowerCase()}~${id}`;
  }

  private getTargetId(tenant: IXosTenantModel) {

    let targetId;
    if (tenant.subscriber_service_id) {
      targetId = this.d3Id('service', tenant.subscriber_service_id);
    }
    else if (tenant.subscriber_tenant_id) {
      targetId = this.d3Id('tenant', tenant.subscriber_tenant_id);
    }
    else if (tenant.subscriber_network_id) {
      targetId = this.d3Id('network', tenant.subscriber_network_id);
    }
    else if (tenant.subscriber_root_id) {
      // FIXME understand what's the correct model for the subscriber
      targetId = this.d3Id('tenantroot', tenant.subscriber_root_id);
    }
    return targetId;
  }

  private getSourceId(tenant: IXosTenantModel) {
    return this.d3Id('service', tenant.provider_service_id);
  }

  private getNodeType(n: any) {
    return n.class_names.split(',')[0].toLowerCase();
  }

  private getNodeLabel(n: any) {
    if (this.getNodeType(n) === 'tenant') {
      return n.id;
    }
    return n.humanReadableName ? n.humanReadableName : n.name;
  }

  private removeUnwantedFineGrainedData(data: IXosFineGrainedGraphData): IXosFineGrainedGraphData {
    data.tenants = _.filter(data.tenants, t => t.kind !== 'coarse');
    data.networks = _.filter(data.networks, n => {
      const subscriber = _.findIndex(data.tenants, {subscriber_network_id: n.id});
      return subscriber > -1;
    });
    return data;
  }

  private graphDataToCoarseGraph(data: IXosCoarseGraphData) {

    try {
      const links: IXosServiceGraphLink[] = _.chain(data.servicedependencys)
        .map((t: IXosTenantModel) => {
          return {
            id: t.id,
            source: this.getNodeIndexById(t.provider_service_id, data.services),
            target: this.getNodeIndexById(t.subscriber_service_id, data.services),
            model: t
          };
        })
        .value();

      const nodes: IXosServiceGraphNode[] = _.map(data.services, (s: IXosServiceModel) => {
        return {
          id: s.id,
          label: s.name,
          model: s
        };
      });

      let graph: IXosServiceGraph = {
        nodes,
        links
      };

      this.d3CoarseGraph.next(graph);
    } catch (e) {
      this.d3CoarseGraph.error(e);
    }
  }

  private graphDataToFineGrainedGraph(data: IXosFineGrainedGraphData) {
    try {
      data = this.removeUnwantedFineGrainedData(data);

      let nodes = _.reduce(Object.keys(data), (list: any[], k: string) => {
        return list.concat(data[k]);
      }, []);

      nodes = _.chain(nodes)
        .map(n => {
          n.d3Id = this.d3Id(this.getNodeType(n), n.id);
          return n;
        })
        .map(n => {
          let node: IXosServiceGraphNode = {
            id: n.d3Id,
            label: this.getNodeLabel(n),
            model: n,
            type: this.getNodeType(n)
          };
          return node;
        })
        .value();

      const links = _.reduce(data.tenants, (links: IXosServiceGraphLink[], tenant: IXosTenantModel) => {
        const sourceId = this.getSourceId(tenant);
        const targetId = this.getTargetId(tenant);

        if (angular.isDefined(targetId)) {
          const tenantToSubscriber = {
            id: `${tenant.d3Id}_${targetId}`,
            source: this.getNodeIndexById(tenant.d3Id, nodes),
            target: this.getNodeIndexById(targetId, nodes),
            model: tenant
          };

          if (angular.isDefined(tenantToSubscriber.source) && angular.isDefined(tenantToSubscriber.target)) {
            links.push(tenantToSubscriber);
          }
        }

        if (angular.isDefined(sourceId)) {
          const tenantToProvider = {
            id: `${sourceId}_${tenant.d3Id}`,
            source: this.getNodeIndexById(sourceId, nodes),
            target: this.getNodeIndexById(tenant.d3Id, nodes),
            model: tenant
          };

          if (angular.isDefined(tenantToProvider.source) && angular.isDefined(tenantToProvider.target)) {
            links.push(tenantToProvider);
          }
        }

        return links;
      }, []);

      if (nodes.length === 0 && links.length === 0) {
        return;
      }

      let graph: IXosServiceGraph = {
        nodes,
        links
      };

      this.d3FineGrainedGraph.next(graph);
    } catch (e) {
     this.d3FineGrainedGraph.error(e);
    }
  }
}
