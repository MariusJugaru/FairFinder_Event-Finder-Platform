import { Component, OnInit, ViewChild, ElementRef, Output, EventEmitter, OnDestroy, AfterViewInit } from "@angular/core";
import esri = __esri;
import { MatDrawer } from '@angular/material/sidenav';

import Config from "@arcgis/core/config";
import WebMap from "@arcgis/core/WebMap";
import MapView from "@arcgis/core/views/MapView";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import { AuthService } from "src/app/services/auth.service";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import FeatureSet from "@arcgis/core/rest/support/FeatureSet";
import RouteParameters from "@arcgis/core/rest/support/RouteParameters";
import * as route from "@arcgis/core/rest/route.js";
import { Router } from '@angular/router';

import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import { ToastService } from "src/app/services/toast.service";

import Collection from "@arcgis/core/core/Collection";

// --- SERVICIUL DE EVENIMENTE (Ramas neschimbat) ---
@Injectable({
  providedIn: 'root'
})
export class EventService {
  private baseUrl = 'http://127.0.0.1:8081';

  constructor(private http: HttpClient, private authService: AuthService) { }

  saveEvent(eventData: any): Observable<any> {
    const token = this.authService.getToken();
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    });
    return this.http.post(`${this.baseUrl}/post_event`, eventData, { headers });
  }
  deleteEvent(eventId: string): Observable<any> {
    const token = this.authService.getToken();
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`
    });
    return this.http.delete(`${this.baseUrl}/delete_event/${eventId}`, { headers });
  }

  getAllEvents(): Observable<any[]> {
    return this.http.get<any[]>(`${this.baseUrl}/get_events`);
  }

  getParticipation(eventId: number, userId: number): Observable<Participation> {
    return this.http.get<Participation>(`${this.baseUrl}/participation/${eventId}/users/${userId}`)
  }

  postParticipation(payload: { user_id: number, event_id: number, status: string }): Observable<any> {
    const token = this.authService.getToken();
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    });
    
    return this.http.post(`${this.baseUrl}/post_participation`, payload, { headers });
  }
}

export interface MapFeature {
  id: string;
  type: 'Point' | 'Polygon' | 'Polyline';
  graphic: esri.Graphic;
}

export interface Participation {
  id?: number;
  user_id: number;
  event_id: number;
  status: "Going" | "Interested" | "Not going";
}

type AppMode = 'NONE' | 'ADD_EVENT' | 'ROUTING';

@Component({
  selector: "app-map",
  templateUrl: "./map.component.html",
  styleUrls: ["./map.component.scss"],
})
export class MapComponent implements OnInit, OnDestroy, AfterViewInit {
  appMode: AppMode = 'NONE';
  fabOpen = false;
  loaded = false;
  loggedIn = false;
  menuOpen = false;
  searchQuery = "";

  @Output() mapLoadedEvent = new EventEmitter<boolean>();
  @ViewChild("mapViewNode", { static: true }) private mapViewEl: ElementRef;
  @ViewChild('drawer') drawer!: MatDrawer;        // Meniul stanga
  @ViewChild('rightMenu') rightMenu!: MatDrawer;  // Meniul Add Event
  @ViewChild('routeMenu') routeMenu!: MatDrawer;  // Meniul Rutare (NOU)

  // Map & Layers
  map: esri.Map;
  view: esri.MapView;
  graphicsLayer: esri.GraphicsLayer;            // General purpose
  graphicsLayerUserPoints: esri.GraphicsLayer;  // Puncte user (event creation)
  graphicsLayerRoutes: esri.GraphicsLayer;      // Rute
  graphicsLayerEvents: GraphicsLayer;           // Evenimente incarcate din DB
  trailheadsLayer: esri.FeatureLayer;

  zoom = 10;
  center: Array<number> = [-118.73682450024377, 34.07817583063242];
  basemap = "streets-vector";

  // --- Variabile pentru ADD EVENT ---
  tempPoints: esri.Graphic[] = []
  geometryType: 'Point' | 'Polygon' | 'Polyline' = 'Point';
  mapFeatures: MapFeature[] = [];
  eventData = {
    title: '',
    description: '',
    start_time: '',
    end_time: '',
    color: '#1abc9c'
  };

  // --- Variabile pentru RUTARE ---
  activeRoutingField: 'start' | 'end' | null = null; // Campul selectat curent
  startPointGraphic: esri.Graphic | null = null;
  endPointGraphic: esri.Graphic | null = null;
  userLocationGraphic: esri.Graphic | null = null;
  startPointName: string = '';
  endPointName: string = '';

  constructor(
    private authService: AuthService,
    private router: Router,
    private eventService: EventService,
    private toast: ToastService
  ) { }

  ngOnInit() {
    this.initializeMap().then(() => {
      this.loaded = this.view.ready;
      this.mapLoadedEvent.emit(true);
      this.setUserLocation(); // Centrare initiala
      this.loggedIn = this.authService.isLoggedIn();
    });

    this.loadEventsOnMap();
  }

  ngAfterViewInit() {
    this.rightMenu.closedStart.subscribe(() => {
      if (this.appMode === 'ADD_EVENT') {
        this.appMode = 'NONE';
      }
      this.tempPoints.forEach(graphic => this.graphicsLayerUserPoints.remove(graphic));
      this.tempPoints = [];
      this.mapFeatures = [];
      this.resetEventForm();
    });

    // Cleanup Routing când se închide meniul de rutare
    if (this.routeMenu) {
      this.routeMenu.closedStart.subscribe(() => {
        if (this.appMode === 'ROUTING') {
          this.appMode = 'NONE';
          this.clearRouter();
        }
      });
    }
  }

  ngOnDestroy() {
    if (this.view) {
      this.view.container = null;
    }
  }

  // --- INITIALIZARE HARTA ---
  async initializeMap() {
    try {
      Config.apiKey = "AAPTxy8BH1VEsoebNVZXo8HurKqlhvUKBfNssoTzTUwwyzWBytmWSpxC7jBfTuYIewz1OefDzWcPQlhGwhpCKa58tfYcQgzCqmFnKeItW9gpQTLb3Humpe1L62cfQcQmTiHZynTcISGk_-Tn9JG79k5qhY3IIuhDuh1-62S6ucWv7wroiByU-rZBpxxGK0Tb93LTvBngZ1bOq0Qo4mNQz2UQeqoEIvIYN6RTSitQQCfq_RE.AT1_7gEwBK61";

      this.map = new WebMap({ basemap: this.basemap });

      this.addFeatureLayers();
      this.addGraphicsLayer();

      this.view = new MapView({
        container: this.mapViewEl.nativeElement,
        center: this.center,
        zoom: this.zoom,
        map: this.map,
      });

      // Asteptam ca harta sa fie gata
      await this.view.when();

      // Setam starea loaded
      this.loaded = this.view.ready;
      this.mapLoadedEvent.emit(true);

      // --- AICI LEGAM EVENIMENTELE (CLICK & POPUP) ---
      this.setupEventHandlers();

      console.log("ArcGIS map loaded successfully");

      // Centrare initiala
      this.setUserLocation();

    } catch (error) {
      console.error("Critical Error loading the map: ", error);
      this.toast.showToast("Map initialized with warnings (check console)", "warning");
    }
  }
  handleDeleteEvent() {
    // 1. Obținem elementul selectat în popup
    const selectedFeature = this.view.popup.selectedFeature;

    if (!selectedFeature || !selectedFeature.attributes) {
      return;
    }

    // 2. Extragem ID-ul și Titlul (pentru confirmare)
    // Asigură-te că backend-ul trimite 'id' sau '_id' și că e salvat în atribute
    const eventId = selectedFeature.attributes.id || selectedFeature.attributes._id;
    const eventTitle = selectedFeature.attributes.title;

    if (!eventId) {
      this.toast.showToast("Eroare: Nu s-a găsit ID-ul evenimentului.", "error");
      return;
    }

    // 3. Confirmare (opțional, dar recomandat)
    if (!confirm(`Ești sigur că vrei să ștergi evenimentul "${eventTitle}"?`)) {
      return;
    }

    // 4. APELUL CĂTRE SERVICE (Aici e partea cu SUBSCRIBE, exact ca la saveEvent)
    this.eventService.deleteEvent(eventId).subscribe({
      next: (res) => {
        // SUCCESS: Ce facem după ce s-a șters
        this.toast.showToast('Eveniment șters cu succes!', 'success');

        // Închidem popup-ul
        this.view.popup.close();

        // Reîncărcăm harta ca să dispară markerul șters
        this.loadEventsOnMap();
      },
      error: (err) => {
        // ERROR: Ce facem dacă nu merge
        console.error('Eroare la ștergere:', err);
        this.toast.showToast('Nu s-a putut șterge evenimentul.', 'error');
      }
    });
  }
  handleEventStatus(status: "Going" | "Interested" | "Not going") {
    const selectedFeature = this.view.popup.selectedFeature;
    if (!selectedFeature || !selectedFeature.attributes) {
      this.toast.showToast("No event selected", "error");
      return;
    }

    const eventId = selectedFeature.attributes.id;
    const userId = this.authService.getUserId();
    if (!userId) {
      this.toast.showToast("You must be logged in to set participation!", "warning");
      return;
    }

    const payload = {
      user_id: userId,
      event_id: eventId,
      status: status
    }

    // Send payload to backend
    this.eventService.postParticipation(payload).subscribe({
      next: (res) => {
        this.toast.showToast("Participation set sucessfully!", "success");

        const currentStatus = status;
        const currentUserId = this.authService.getUserId();
        const actions: Collection = new Collection();

        selectedFeature.attributes.going = res.going;
        selectedFeature.attributes.not_going = res.not_going;
        selectedFeature.attributes.interested = res.interested;
        
        selectedFeature.popupTemplate.content = (feature) => {
          const attr = feature.graphic.attributes;
          const startDate = new Date(attr.start_time).toLocaleString();
          const endDate = new Date(attr.end_time).toLocaleString();
          return `
            <b>Description:</b> ${attr.description}<br>
            <b>Start:</b> ${startDate}<br>
            <b>End:</b> ${endDate}<br>
            <br><b><u>Statistics</u></b><br>
            <b>Going:</b> ${attr.going}<br>
            <b>Not going:</b> ${attr.not_going}<br>
            <b>Interested:</b> ${attr.interested}<br>
            <br>
            <b>Age Average:</b> ${res.ageAvg}<br>
            <br>
            <b><u>Gender distribution</u></b><br>
            Male: ${res.malePerc}%<br>
            Female: ${res.femalePerc}%<br>
            Not-Specified: ${res.notPerc}%<br>
          `;
        };

        actions.push({
          title: "Navigate to",
          id: "navigate-to-event",
          className: "esri-icon-directions",
          type: "button"
        });

        // Delete dacă e owner
        if (selectedFeature.attributes.owner_id === currentUserId) {
          actions.push({
            title: "Delete Event",
            id: "delete-event",
            className: "esri-icon-trash",
            type: "button"
          });
        }

        // Status buttons
        if (currentStatus !== "Going") actions.push({ title: "Going", id: "event-going", className: "esri-icon-check-mark", type: "button" });
        if (currentStatus !== "Not going") actions.push({ title: "Not going", id: "event-not_going", className: "esri-icon-check-mark", type: "button" });
        if (currentStatus !== "Interested") actions.push({ title: "Interested", id: "event-interested", className: "esri-icon-check-mark", type: "button" });

        selectedFeature.popupTemplate.actions = actions;
        this.view.popup.reposition();
        this.view.popup.open({
          features: [selectedFeature]
        });
        
      },
      error: (err) => {
        console.error("Error updating participation!", err);
        this.toast.showToast("Could not update participation", "error");
      }
    });

  }
  setupEventHandlers() {
    // 1. CLICK PE HARTĂ (General)
    this.view.on("click", (event) => {
      const point = this.view.toMap(event);
      if (!point) return;

      // Debugging
      console.log(`Click detected. AppMode: ${this.appMode}`);

      if (this.appMode === 'ADD_EVENT') {
        this.handleAddEventClick(point);
      } else if (this.appMode === 'ROUTING') {
        this.handleRoutingClick(point);
      }
    });

    // 2. CLICK PE BUTONUL DIN POPUP (Navigate Here) - FIXAT CU REACTIVE UTILS
    reactiveUtils.on(
      () => this.view.popup,
      "trigger-action",
      (event: any) => {
        // Verificăm ID-ul acțiunii
        if (event.action.id === "navigate-to-event") {
          this.handleNavigateToEvent();
        } else if (event.action.id === "delete-event") {
          this.handleDeleteEvent();
        } else if (event.action.id === "event-going") {
          this.handleEventStatus("Going");
        } else if (event.action.id === "event-not_going") {
          this.handleEventStatus("Not going");
        } else if (event.action.id === "event-interested") {
          this.handleEventStatus("Interested");
        }
      }
    );
  }

  // 1. Activare mod rutare din FAB
  startRoutingMode() {
    this.appMode = 'ROUTING';
    this.fabOpen = false;

    // Inchide celelalte meniuri
    this.rightMenu.close();
    this.routeMenu.open();

    // Resetare stare
    this.clearRouter();

    // Auto-completare Start Point cu locatia curenta (daca e disponibila)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        // Setam start point automat
        this.updateRoutingPoint('start', lat, lon, "My Current Location");

        // Focusam automat pe destinatie
        this.activeRoutingField = 'end';
      }, (err) => {
        // Daca nu merge locatia, incepem cu Start Field selectat
        this.activeRoutingField = 'start';
      });
    } else {
      this.activeRoutingField = 'start';
    }
  }

  // 2. Selectare camp activ (Start sau End) din UI
  selectRoutingField(field: 'start' | 'end') {
    this.activeRoutingField = field;
  }

  // 3. Click pe harta in mod rutare
  handleRoutingClick(point: __esri.Point) {
    if (!this.activeRoutingField) {
      this.toast.showToast('Select Start or Destination field first', 'info');
      return;
    }

    // Formatare nume coordonate
    const name = `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;

    // Actualizare punct
    this.updateRoutingPoint(this.activeRoutingField, point.latitude, point.longitude, name);
  }
  // Metoda noua pentru butonul de "Shortcut Locatie Curenta"
  setToCurrentLocation(type: 'start' | 'end') {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;

          // Apelam metoda existenta de update
          this.updateRoutingPoint(type, lat, lon, "My Current Location");

          // Daca am setat startul, mutam focusul pe destinatie automat
          if (type === 'start') {
            this.activeRoutingField = 'end';
          }
        },
        (err) => {
          console.error(err);
          this.toast.showToast("Could not get current location.", "error");
        }
      );
    } else {
      this.toast.showToast("Geolocation is not supported by this browser.", "error");
    }
  }
  // 4. Update grafic si variabila
  updateRoutingPoint(type: 'start' | 'end', lat: number, lon: number, name: string) {
    const point = new Point({ latitude: lat, longitude: lon });

    // Stiluri diferite: Albastru pt Start, Rosu pt End
    const color = type === 'start' ? [52, 152, 219] : [231, 76, 60];

    const symbol = {
      type: "simple-marker",
      color: color,
      outline: { color: [255, 255, 255], width: 2 },
      size: 10
    };

    const graphic = new Graphic({ geometry: point, symbol: symbol });

    if (type === 'start') {
      // Sterge vechiul start daca exista
      if (this.startPointGraphic) this.graphicsLayerUserPoints.remove(this.startPointGraphic);

      this.startPointGraphic = graphic;
      this.startPointName = name;

      // Muta automat focusul pe destinatie dupa ce ai ales startul
      this.activeRoutingField = 'end';
    } else {
      // Sterge vechiul end daca exista
      if (this.endPointGraphic) this.graphicsLayerUserPoints.remove(this.endPointGraphic);

      this.endPointGraphic = graphic;
      this.endPointName = name;

      // Am terminat selectia
      this.activeRoutingField = null;
    }

    this.graphicsLayerUserPoints.add(graphic);

    // Stergem ruta veche daca modificam punctele
    this.removeRoutes();
  }

  // 5. Stergere punct individual (din UI X button)
  clearSinglePoint(type: 'start' | 'end') {
    if (type === 'start' && this.startPointGraphic) {
      this.graphicsLayerUserPoints.remove(this.startPointGraphic);
      this.startPointGraphic = null;
      this.startPointName = '';
      this.activeRoutingField = 'start';
    } else if (type === 'end' && this.endPointGraphic) {
      this.graphicsLayerUserPoints.remove(this.endPointGraphic);
      this.endPointGraphic = null;
      this.endPointName = '';
      this.activeRoutingField = 'end';
    }
    this.removeRoutes();
  }

  // 6. Butonul "Calculate Route"
  triggerRouteCalculation() {
    if (!this.startPointGraphic || !this.endPointGraphic) {
      this.toast.showToast('Please select both start and destination points', 'error');
      return;
    }
    const routeUrl = "https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World";
    this.calculateRoute(routeUrl);
  }

  // 7. Calcul efectiv (API Call)
  async calculateRoute(routeUrl: string) {
    const routeParams = new RouteParameters({
      // Folosim explicit punctele salvate
      stops: new FeatureSet({
        features: [this.startPointGraphic!, this.endPointGraphic!]
      }),
      returnDirections: true,
    });

    try {
      const data = await route.solve(routeUrl, routeParams);
      this.displayRoute(data);
    } catch (error) {
      console.error("Error calculating route: ", error);
      this.toast.showToast('Could not calculate route', 'error');
    }
  }

  // 8. Afisare ruta si directii
  displayRoute(data: any) {
    // Curata ruta veche
    this.removeRoutes();

    for (const result of data.routeResults) {
      result.route.symbol = { type: "simple-line", color: [5, 150, 255], width: 4 };
      this.graphicsLayerRoutes.graphics.add(result.route);
    }

    // Afisare directii in panoul lateral
    if (data.routeResults.length > 0) {
      this.showDirectionsInPanel(data.routeResults[0].directions.features);
    }
  }

  showDirectionsInPanel(features: any[]) {
    const container = document.getElementById('directions-panel');
    if (container) {
      container.innerHTML = '<h4>Directions:</h4>';
      const list = document.createElement('ol');

      features.forEach((result) => {
        const li = document.createElement('li');
        // Formatare text distanta
        li.innerHTML = `${result.attributes.text} <small style="color:#bdc3c7;">(${result.attributes.length.toFixed(2)} mi)</small>`;
        li.style.marginBottom = '8px';
        li.style.fontSize = '0.9rem';
        list.appendChild(li);
      });

      container.appendChild(list);
    }
  }

  // 9. Resetare completa rutare
  clearRouter() {
    this.removeRoutes();

    // Sterge punctele de pe harta
    if (this.startPointGraphic) this.graphicsLayerUserPoints.remove(this.startPointGraphic);
    if (this.endPointGraphic) this.graphicsLayerUserPoints.remove(this.endPointGraphic);

    this.startPointGraphic = null;
    this.endPointGraphic = null;
    this.startPointName = '';
    this.endPointName = '';
    this.activeRoutingField = null;

    const container = document.getElementById('directions-panel');
    if (container) container.innerHTML = '';
  }

  closeRouting() {
    this.routeMenu.close();
  }

  // --- METODE ADD EVENT ---

  handleAddEventClick(point: __esri.Point) {
    const graphic = this.addPoint(point.latitude, point.longitude);
    const id = Date.now().toString();

    this.mapFeatures.push({
      id,
      type: 'Point',
      graphic
    });

    this.tempPoints.push(graphic);
  }

  addPoint(lat: number, lng: number) {
    let point = new Point({ longitude: lng, latitude: lat });
    const simpleMarkerSymbol = {
      type: "simple-marker",
      color: [226, 119, 40],
      outline: { color: [255, 255, 255], width: 1 },
    };
    let pointGraphic = new Graphic({ geometry: point, symbol: simpleMarkerSymbol });
    this.graphicsLayerUserPoints.add(pointGraphic);

    return pointGraphic;
  }

  removeFeature(id: string) {
    const index = this.mapFeatures.findIndex(f => f.id === id);
    if (index !== -1) {
      const feature = this.mapFeatures[index];
      this.graphicsLayerUserPoints.remove(feature.graphic);
      this.mapFeatures.splice(index, 1);
    }
  }

  saveEvent() {
    if (this.mapFeatures.length === 0) {
      this.toast.showToast("No geometry selected!", "warning");
      return;
    }

    let geometry: any;
    switch (this.geometryType) {
      case 'Point':
        const point = this.mapFeatures[0].graphic.geometry as __esri.Point;
        geometry = { type: 'Point', coordinates: [point.x, point.y] };
        break;
      case 'Polygon':
        geometry = {
          type: 'Polygon',
          coordinates: [this.tempPoints.map(p => {
            const pt = p.geometry as __esri.Point;
            return [pt.x, pt.y];
          })]
        };
        break;
      case 'Polyline':
        geometry = {
          type: 'LineString',
          coordinates: this.tempPoints.map(p => {
            const pt = p.geometry as __esri.Point;
            return [pt.x, pt.y];
          })
        };
        break;
      default:
        return;
    }

    const payload = {
      owner_id: this.authService.getUserId(),
      title: this.eventData.title,
      description: this.eventData.description,
      start_time: this.eventData.start_time,
      end_time: this.eventData.end_time,
      geometry: geometry,
      color: this.eventData.color
    };

    this.eventService.saveEvent(payload).subscribe({
      next: res => {
        this.toast.showToast('Event saved successfully', 'success');
        this.loadEventsOnMap();
        this.rightMenu.close();
      },
      error: err => {
        console.error('Error saving event:', err);
        this.toast.showToast('Error saving event', 'error');
      }
    });
  }

  resetEventForm() {
    this.eventData = {
      title: '',
      description: '',
      start_time: '',
      end_time: '',
      color: '#1abc9c'
    };
  }

  // --- LAYERS & UTILS ---

  addFeatureLayers() {
    this.trailheadsLayer = new FeatureLayer({
      url: "https://services3.arcgis.com/GVgbJbqm8hXASVYi/arcgis/rest/services/Trailheads/FeatureServer/0",
      outFields: ["*"],
    });
    this.map.add(this.trailheadsLayer);

    const trailsLayer = new FeatureLayer({
      url: "https://services3.arcgis.com/GVgbJbqm8hXASVYi/arcgis/rest/services/Trails/FeatureServer/0",
    });
    this.map.add(trailsLayer, 0);

    const parksLayer = new FeatureLayer({
      url: "https://services3.arcgis.com/GVgbJbqm8hXASVYi/arcgis/rest/services/Parks_and_Open_Space/FeatureServer/0",
    });
    this.map.add(parksLayer, 0);
  }

  addGraphicsLayer() {
    this.graphicsLayer = new GraphicsLayer();
    this.map.add(this.graphicsLayer);
    this.graphicsLayerUserPoints = new GraphicsLayer();
    this.map.add(this.graphicsLayerUserPoints);
    this.graphicsLayerRoutes = new GraphicsLayer();
    this.map.add(this.graphicsLayerRoutes);
    this.graphicsLayerEvents = new GraphicsLayer();
    this.map.add(this.graphicsLayerEvents);
  }

  loadEventsOnMap() {
    this.eventService.getAllEvents().subscribe({
      next: (events) => {
        // Curata layer-ul inainte de reload
        this.graphicsLayerEvents.removeAll();

        events.forEach(event => {
          let graphic: Graphic;
          const geom = event.geometry;
          const startDate = new Date(event.start_time).toLocaleString();
          const endDate = new Date(event.end_time).toLocaleString();
          
          const navigateAction = {
            title: "Navighează aici",
            id: "navigate-to-event",
            className: "esri-icon-directions",
            type: "button" as "button"
          };
          
          const currentUserId = this.authService.getUserId();

          if (currentUserId == null) {
            const actions: any[] = [];

            actions.push({
              title: "Navigate to",
              id: "navigate-to-event",
              className: "esri-icon-directions",
              type: "button" as "button"
            });
            if (event.owner_id && event.owner_id === currentUserId) {
              actions.push({
                title: "Delete Event",
                id: "delete-event",
                className: "esri-icon-trash",
                type: "button" as "button"
              });
            }

            const popupTemplate = {
              title: event.title,
              content: `
              <b>Description:</b> ${event.description}<br>
              <b>Start:</b> ${startDate}<br>
              <b>End:</b> ${endDate}<br>
              `,
              actions: actions
            };

            const color = event.color ? this.hexToRgbArray(event.color) : [226, 119, 40];

            if (geom.type === 'Point') {
              const point = new Point({ longitude: geom.coordinates[0], latitude: geom.coordinates[1] });
              graphic = new Graphic({
                geometry: point,
                symbol: new SimpleMarkerSymbol({ color: color, outline: { color: [255, 255, 255], width: 1 } }),
                attributes: event,
                popupTemplate: popupTemplate
              });
            } else if (geom.type === 'Polygon') {
              const polygon = new Polygon({ rings: geom.coordinates });
              graphic = new Graphic({
                geometry: polygon,
                symbol: new SimpleFillSymbol({ color: [...color, 0.5], outline: new SimpleLineSymbol({ color: [255, 255, 255], width: 1 }) }),
                attributes: event,
                popupTemplate: popupTemplate
              });
            } else { // Polyline / LineString
              const polyline = new Polyline({ paths: geom.coordinates });
              graphic = new Graphic({
                geometry: polyline,
                symbol: new SimpleLineSymbol({ color: color, width: 2 }),
                attributes: event,
                popupTemplate: popupTemplate
              });
            }

            if (graphic) this.graphicsLayerEvents.add(graphic);
            return;
          }

          this.eventService.getParticipation(event.id, currentUserId).subscribe(res => {
            const actions: any[] = [];

            actions.push({
              title: "Navigate to",
              id: "navigate-to-event",
              className: "esri-icon-directions",
              type: "button" as "button"
            });
            if (event.owner_id && event.owner_id === currentUserId) {
              actions.push({
                title: "Delete Event",
                id: "delete-event",
                className: "esri-icon-trash",
                type: "button" as "button"
              });
            }
            
            if (res.status !== "Going") {
              actions.push({
                title: "Going",
                id: "event-going",
                className: "esri-icon-check-mark",
                type: "button" as "button"
              });
            }
            if (res.status !== "Not going") {
              actions.push({
                title: "Not going",
                id: "event-not_going",
                className: "esri-icon-check-mark",
                type: "button" as "button"
              });
            }
            if (res.status !== "Interested") {
              actions.push({
                title: "Interested",
                id: "event-interested",
                className: "esri-icon-check-mark",
                type: "button" as "button"
              });
            }

            const popupTemplate = {
              title: event.title,
              content: `
              <b>Description:</b> ${event.description}<br>
              <b>Start:</b> ${startDate}<br>
              <b>End:</b> ${endDate}<br>
              <br><b><u>Statistics</u></b><br>
              <b>Going:</b> ${event.going}<br>
              <b>Not going:</b> ${event.not_going}<br>
              <b>Interested:</b> ${event.interested}<br>
              <br>
              <b>Age Average:</b> ${event.ageAvg}<br>
              <br>
              <b><u>Gender distribution</u></b><br>
              Male: ${event.malePerc}%<br>
              Female: ${event.femalePerc}%<br>
              Not-Specified: ${event.notPerc}%<br>
              `,
              actions: actions
            };

            const color = event.color ? this.hexToRgbArray(event.color) : [226, 119, 40];

            if (geom.type === 'Point') {
              const point = new Point({ longitude: geom.coordinates[0], latitude: geom.coordinates[1] });
              graphic = new Graphic({
                geometry: point,
                symbol: new SimpleMarkerSymbol({ color: color, outline: { color: [255, 255, 255], width: 1 } }),
                attributes: event,
                popupTemplate: popupTemplate
              });
            } else if (geom.type === 'Polygon') {
              const polygon = new Polygon({ rings: geom.coordinates });
              graphic = new Graphic({
                geometry: polygon,
                symbol: new SimpleFillSymbol({ color: [...color, 0.5], outline: new SimpleLineSymbol({ color: [255, 255, 255], width: 1 }) }),
                attributes: event,
                popupTemplate: popupTemplate
              });
            } else { // Polyline / LineString
              const polyline = new Polyline({ paths: geom.coordinates });
              graphic = new Graphic({
                geometry: polyline,
                symbol: new SimpleLineSymbol({ color: color, width: 2 }),
                attributes: event,
                popupTemplate: popupTemplate
              });
            }

            if (graphic) this.graphicsLayerEvents.add(graphic);
          });
        });
      },
      error: (err) => console.error("Error loading events:", err)
    });
  }

  // --- GENERAL UI & AUTH ---
  handleNavigateToEvent() {
    const selectedFeature = this.view.popup.selectedFeature;
    if (!selectedFeature) return;

    // Calculăm centrul
    let centerPoint: __esri.Point;
    if (selectedFeature.geometry.type === 'point') {
      centerPoint = selectedFeature.geometry as __esri.Point;
    } else {
      centerPoint = selectedFeature.geometry.extent.center;
    }

    // Obținem titlul
    const destName = selectedFeature.attributes?.title || "Event Location";

    // IMPORTANT: Închidem popup-ul
    this.view.popup.close();

    // IMPORTANT: Activăm modul RUTARE (asta deschide meniul și setează appMode='ROUTING')
    this.startRoutingMode();

    // Forțăm field-ul activ pe 'end' pentru a seta destinația
    this.activeRoutingField = 'end';

    // Setăm punctul pe hartă
    this.updateRoutingPoint('end', centerPoint.latitude, centerPoint.longitude, destName);

    // Setăm automat startul la locația curentă
    setTimeout(() => {
      this.setToCurrentLocation('start');
    }, 100);
  }
  toggleFabMenu() {
    this.fabOpen = !this.fabOpen;
  }

  openAddEvent() {
    this.appMode = 'ADD_EVENT';
    this.fabOpen = false;
    this.routeMenu.close();
    this.rightMenu.open();
  }

  goToProfile() {
    const userId = this.authService.getUserId();
    if (userId) {
      this.router.navigate(['/profile', userId]);
    }
  }

  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  logout() {
    this.authService.logout();
    this.loggedIn = false;
    this.drawer.close();
  }

  searchLocation() {
    if (!this.searchQuery) return;
    // Mock search - doar centreaza pe LA pentru demo, poti conecta la locatorTask daca vrei
    console.log("Cautare: ", this.searchQuery);
    this.view.goTo({ center: [-118.7, 34.08], zoom: 14 });
  }

  setUserLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lon = position.coords.longitude;
          const lat = position.coords.latitude;
          this.center = [lon, lat];

          // 1. Centrează harta (comportament existent)
          this.view.goTo({ center: this.center, zoom: 14 });

          // 2. Creare/Actualizare Marker Locație (MODIFICAT)
          const point = new Point({ longitude: lon, latitude: lat });

          // Stil "GPS" (Punct albastru cu margine albă)
          const symbol = {
            type: "simple-marker",
            style: "circle",
            color: [66, 133, 244], // Albastru Google
            size: "14px",
            outline: {
              color: [255, 255, 255], // Margine albă
              width: 2
            }
          };

          // Dacă markerul există deja, îi actualizăm doar geometria
          if (this.userLocationGraphic) {
            this.userLocationGraphic.geometry = point;
          } else {
            // Dacă nu există, îl creăm și îl adăugăm pe layer-ul general
            this.userLocationGraphic = new Graphic({
              geometry: point,
              symbol: symbol,
              popupTemplate: {
                title: "Locația ta",
                content: "Te afli aici."
              }
            });
            this.graphicsLayer.add(this.userLocationGraphic);
          }
        },
        (error) => {
          console.error("Geolocalizare esuata: ", error);
          this.toast.showToast("Nu s-a putut obține locația curentă.", "warning");
        }
      );
    } else {
      this.toast.showToast("Browserul nu suportă geolocalizarea.", "error");
    }
  }

  hexToRgbArray(hex: string): number[] {
    const bigint = parseInt(hex.replace('#', ''), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  }

  removeRoutes() {
    this.graphicsLayerRoutes.removeAll();
  }
}