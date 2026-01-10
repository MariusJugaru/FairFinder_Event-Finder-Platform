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
import * as locator from "@arcgis/core/rest/locator";
import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import HeatmapRenderer from "@arcgis/core/renderers/HeatmapRenderer";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import Polygon from "@arcgis/core/geometry/Polygon";
import Polyline from "@arcgis/core/geometry/Polyline";
import { ToastService } from "src/app/services/toast.service";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import { ChartConfiguration, ChartData, ChartType } from 'chart.js';
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
  allEventsList: any[] = [];
  filteredEvents: any[] = [];
  zoom = 10;
  heatmapLayer: FeatureLayer | null = null;
  center: Array<number> = [-118.73682450024377, 34.07817583063242];
  basemap = "arcgis-navigation";
  // === VARIABILE NOI PENTRU MODAL SI STATISTICI ===
  showStatsModal = false;
  activeTab: 'demographics' | 'time-space' = 'demographics';
  // Date calculate
  selectedEventStats = {
    title: '',
    durationHours: 0,
    areaSize: 'N/A', // Pt poligoane
    ageAvg: 0,
    insights: [] as string[],
    ageGroups: [] as { label: string, count: number, percent: number }[]
  };

  // Configuratii Grafice (Stil)
  pieOptions: ChartConfiguration['options'] = {
    responsive: true,
    plugins: { legend: { position: 'bottom' } }
  };
  // Datele pentru grafice
  participationChartData: ChartData<'pie'> = { labels: [], datasets: [] };
  genderChartData: ChartData<'doughnut'> = { labels: [], datasets: [] };
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
      this.view.ui.remove("attribution");
      reactiveUtils.watch(
        () => this.view.zoom,
        (zoom) => {
          this.updateLayerVisibilityByZoom(zoom);
        }
      );
    } catch (error) {
      console.error("Critical Error loading the map: ", error);
      this.toast.showToast("Map initialized with warnings (check console)", "warning");
    }
  }
  handleDeleteEvent() {
    //  Obtinem elementul selectat in popup
    const selectedFeature = this.view.popup.selectedFeature;

    if (!selectedFeature || !selectedFeature.attributes) {
      return;
    }

    //  Extragem ID-ul si Titlul
    const eventId = selectedFeature.attributes.id || selectedFeature.attributes._id;
    const eventTitle = selectedFeature.attributes.title;

    if (!eventId) {
      this.toast.showToast("Error: Event ID was not found.", "error");
      return;
    }

    if (!confirm(`Do you want to delete event "${eventTitle}"?`)) {
      return;
    }

    // 4. Apel catre service
    this.eventService.deleteEvent(eventId).subscribe({
      next: (res) => {
        this.toast.showToast('Event deleted succesfully!', 'success');

        this.view.popup.close();

        this.loadEventsOnMap();
      },
      error: (err) => {
        console.error('Eroare la stergere:', err);
        this.toast.showToast('Event could not be deleted.', 'error');
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
        this.toast.showToast("Participation set successfully!", "success");

        const currentStatus = status;
        const currentUserId = this.authService.getUserId();
        const actions: Collection = new Collection();

        // Actualizam atributele graficului pentru graficele din Modal
        selectedFeature.attributes.going = res.going;
        selectedFeature.attributes.not_going = res.not_going;
        selectedFeature.attributes.interested = res.interested;

        // De asemenea actualizam procentele pentru demografie
        selectedFeature.attributes.ageAvg = res.ageAvg;
        selectedFeature.attributes.malePerc = res.malePerc;
        selectedFeature.attributes.femalePerc = res.femalePerc;
        selectedFeature.attributes.notPerc = res.notPerc;
        selectedFeature.attributes.age_distribution = res.age_distribution;
        selectedFeature.popupTemplate.content = (feature) => {
          const attr = feature.graphic.attributes;
          const startDate = new Date(attr.start_time).toLocaleString();
          const endDate = new Date(attr.end_time).toLocaleString();
          return `
        <div style="font-family: sans-serif; color: #555;">
          <b>Description:</b> ${attr.description}<br>
          <div style="margin-top: 8px; font-size: 0.9em; color: #777;">
            <i class="far fa-clock"></i> ${startDate} <br> 
            <i class="fas fa-arrow-right"></i> ${endDate}
          </div>
        </div>
      `;
        };

        // Refacem butoanele
        actions.push({
          title: "Navigate to",
          id: "navigate-to-event",
          className: "esri-icon-directions",
          type: "button"
        });

        // adaugam butonul view stats
        actions.push({
          title: "View Stats",
          id: "view-stats",
          className: "esri-icon-chart",
          type: "button"
        });

        // Delete daca e owner
        if (selectedFeature.attributes.owner_id === currentUserId) {
          actions.push({
            title: "Delete Event",
            id: "delete-event",
            className: "esri-icon-trash",
            type: "button"
          });
        }

        // Status buttons (le excludem pe cel curent)
        if (currentStatus !== "Going") actions.push({ title: "Going", id: "event-going", className: "esri-icon-check-mark", type: "button" });
        if (currentStatus !== "Not going") actions.push({ title: "Not going", id: "event-not_going", className: "esri-icon-check-mark", type: "button" });
        if (currentStatus !== "Interested") actions.push({ title: "Interested", id: "event-interested", className: "esri-icon-check-mark", type: "button" });

        selectedFeature.popupTemplate.actions = actions;

        this.view.popup.close();
        this.view.popup.open({
          features: [selectedFeature]
        });
        const eventIndex = this.allEventsList.findIndex(e => e.id === eventId || e._id === eventId);
        if (eventIndex !== -1) {
          this.allEventsList[eventIndex].going = res.going;
          this.allEventsList[eventIndex].interested = res.interested;
        }

        // 2. Regenerăm heatmap-ul cu noile date
        this.createHeatmapLayer(this.allEventsList);
      },
      error: (err) => {
        console.error("Error updating participation!", err);
        this.toast.showToast("Could not update participation", "error");
      }
    });

  }
  setupEventHandlers() {
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

    reactiveUtils.on(
      () => this.view.popup,
      "trigger-action",
      (event: any) => {
        // Verificăm ID-ul acțiunii
        if (event.action.id === "navigate-to-event") {
          this.handleNavigateToEvent();
        } else if (event.action.id === "delete-event") {
          this.handleDeleteEvent();
        } else if (event.action.id === "view-stats") {
          // AICI SE DESCHIDE MODALUL
          this.openStatsModal();
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
  openStatsModal() {
    const selectedFeature = this.view.popup.selectedFeature;
    if (!selectedFeature) return;

    const attrs = selectedFeature.attributes;
    const geom = selectedFeature.geometry;

    // --- Time & Space Logic (Keep existing) ---
    const start = new Date(attrs.start_time);
    const end = new Date(attrs.end_time);
    const durationHrs = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

    let areaDisplay = "N/A (Point Event)";
    let areaSqMeters = 0;
    if (geom.type === 'polygon') {
      areaSqMeters = Math.abs(geometryEngine.geodesicArea(geom as any, "square-meters"));
      if (areaSqMeters > 10000) {
        areaDisplay = `${(areaSqMeters / 1000000).toFixed(2)} km²`;
      } else {
        areaDisplay = `${areaSqMeters.toFixed(0)} m²`;
      }
    }

    const insightsMessages: string[] = [];
    if (areaSqMeters > 10000) insightsMessages.push("This event covers a huge area (> 10000m²). Wear comfortable shoes!");
    if (durationHrs > 24) insightsMessages.push("Long-term event (multiday). Consider nearby accommodation.");
    else if (durationHrs <= 5) insightsMessages.push("Short duration event. Perfect for a quick visit.");

    // --- NEW: AGE DISTRIBUTION LOGIC ---

    const rawDistribution = attrs.age_distribution || { "18-24": 0, "25-34": 0, "35-44": 0, "45+": 0 };

    let totalParticipants = 0;
    Object.values(rawDistribution).forEach((val: any) => totalParticipants += val);

    const categories = ["18-24", "25-34", "35-44", "45+"];
    const processedGroups = categories.map(cat => {
      const count = rawDistribution[cat] || 0;
      const percent = totalParticipants > 0 ? (count / totalParticipants) * 100 : 0;
      return {
        label: cat,
        count: count,
        percent: Math.round(percent)
      };
    });

    // --- Chart Data (Keep existing) ---
    this.participationChartData = {
      labels: ['Going', 'Interested', 'Not Going'],
      datasets: [{
        data: [attrs.going || 0, attrs.interested || 0, attrs.not_going || 0],
        backgroundColor: ['#2ecc71', '#f1c40f', '#e74c3c'],
        hoverBackgroundColor: ['#27ae60', '#f39c12', '#c0392b']
      }]
    };

    this.genderChartData = {
      labels: ['Male', 'Female', 'Not Specified'],
      datasets: [{
        data: [attrs.malePerc || 0, attrs.femalePerc || 0, attrs.notPerc || 0],
        backgroundColor: ['#3498db', '#9b59b6', '#95a5a6']
      }]
    };

    // --- UPDATE STATE ---
    this.selectedEventStats = {
      title: attrs.title,
      durationHours: parseFloat(durationHrs.toFixed(1)),
      areaSize: areaDisplay,
      ageAvg: attrs.ageAvg || 0,
      insights: insightsMessages,
      ageGroups: processedGroups
    };

    this.showStatsModal = true;
    this.view.popup.close();
    this.fabOpen = false;
  }

  closeStatsModal() {
    this.showStatsModal = false;
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
        this.allEventsList = events;
        this.graphicsLayerEvents.removeAll();
        if (this.heatmapLayer) {
          this.map.remove(this.heatmapLayer);
          this.heatmapLayer = null;
        }

        // 3. Generăm Heatmap-ul (funcția nouă)
        this.createHeatmapLayer(events);
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
            actions.push({
              title: "View Stats",
              id: "view-stats",
              className: "esri-icon-chart", // Iconita de grafic
              type: "button"
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
              <div style="font-family: sans-serif; color: #555;">
                  <b>Description:</b> ${event.description}<br>
                  <div style="margin-top: 8px; font-size: 0.9em; color: #777;">
                    <i class="far fa-clock"></i> ${startDate} <br> 
                    <i class="fas fa-arrow-right"></i> ${endDate}
                  </div>
              </div>
              `,
              actions: actions // Lista de butoane
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
            actions.push({
              title: "View Stats",
              id: "view-stats",
              className: "esri-icon-chart",
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
        this.updateLayerVisibilityByZoom();
      },
      error: (err) => console.error("Error loading events:", err)
    });
  }

  createHeatmapLayer(events: any[]) {
    if (this.heatmapLayer) {
      this.map.remove(this.heatmapLayer);
      this.heatmapLayer = null;
    }

    let validPointsCount = 0;

    const graphicsSource: Graphic[] = events
      .filter(e => e.geometry && e.geometry.coordinates)
      .map((event, index) => {
        let lat = 0, lon = 0;
        if (event.geometry.type === 'Point') {
          lon = event.geometry.coordinates[0];
          lat = event.geometry.coordinates[1];
        } else if (event.geometry.type === 'Polygon') {
          lon = event.geometry.coordinates[0][0][0];
          lat = event.geometry.coordinates[0][0][1];
        } else {
          lon = event.geometry.coordinates[0][0];
          lat = event.geometry.coordinates[0][1];
        }

        const going = Number(event.going) || 0;
        const interested = Number(event.interested) || 0;
        let popularityScore = (going * 3) + interested;

        // Fix vizibilitate pentru scor 0
        if (popularityScore === 0) popularityScore = 1;

        validPointsCount++;

        return new Graphic({
          geometry: new Point({ longitude: lon, latitude: lat }),
          attributes: { ObjectID: index, score: popularityScore }
        });
      });


    const renderer = new HeatmapRenderer({
      field: "score",
      colorStops: [
        { ratio: 0, color: "rgba(255, 255, 255, 0)" },
        { ratio: 0.01, color: "rgba(0, 255, 255, 0.6)" }, // Se vede imediat ce exista o urma de activitate
        { ratio: 0.02, color: "rgba(255, 255, 0, 0.9)" },
        { ratio: 0.05, color: "rgba(255, 0, 0, 1)" }
      ],
      radius: 40,

      maxDensity: 0.4
    });

    this.heatmapLayer = new FeatureLayer({
      source: graphicsSource,
      title: "Event Heatmap",
      objectIdField: "ObjectID",
      geometryType: "point",
      spatialReference: { wkid: 4326 },
      fields: [
        { name: "ObjectID", type: "oid" },
        { name: "score", type: "integer" }
      ],
      renderer: renderer as any,
      visible: false
    });

    this.map.add(this.heatmapLayer);
    this.updateLayerVisibilityByZoom();
  }

  updateLayerVisibilityByZoom(zoomLevel?: number) {
    const currentZoom = zoomLevel || (this.view ? this.view.zoom : 10);
    const ZOOM_THRESHOLD = 12;

    // Adauga acest log pentru debug:

    if (currentZoom < ZOOM_THRESHOLD) {
      if (this.heatmapLayer) this.heatmapLayer.visible = true;
      if (this.graphicsLayerEvents) this.graphicsLayerEvents.visible = false;
    } else {
      if (this.heatmapLayer) this.heatmapLayer.visible = false;
      if (this.graphicsLayerEvents) this.graphicsLayerEvents.visible = true;
    }
  }
  onSearchChange(query: string) {
    this.searchQuery = query; // Actualizam variabila

    if (!query || query.length === 0) {
      this.filteredEvents = [];
      return;
    }

    // Filtram evenimentele care contin textul (case insensitive)
    this.filteredEvents = this.allEventsList.filter(e =>
      e.title.toLowerCase().includes(query.toLowerCase())
    );
  }

  //  Se apeleaza cand se da click pe un rezultat
  selectSearchedEvent(eventData: any) {
    // 1. Curatam cautarea
    this.filteredEvents = [];
    this.searchQuery = eventData.title;

    // 2. Cautam graficul corespunzator in layer-ul hartii
    const graphic = this.graphicsLayerEvents.graphics.find((g) => {
      return g.attributes && (g.attributes.id === eventData.id || g.attributes._id === eventData.id);
    });

    if (graphic) {
      // 3. Zoom la eveniment
      this.view.goTo({
        target: graphic,
        zoom: 15
      });

      // 4. Deschidem popup-ul automat
      this.view.popup.open({
        features: [graphic],
        location: graphic.geometry
      });
    } else {
      this.toast.showToast("Event was not found on map.", "warning");
    }
  }
  handleNavigateToEvent() {
    const selectedFeature = this.view.popup.selectedFeature;
    if (!selectedFeature) return;

    // Calculam centrul
    let centerPoint: __esri.Point;
    if (selectedFeature.geometry.type === 'point') {
      centerPoint = selectedFeature.geometry as __esri.Point;
    } else {
      centerPoint = selectedFeature.geometry.extent.center;
    }

    // Obtinem titlul
    const destName = selectedFeature.attributes?.title || "Event Location";

    // inchidem popup-ul
    this.view.popup.close();

    // Activam modul RUTARE 
    this.startRoutingMode();

    // Fortam field-ul activ pe 'end' pentru a seta destinatia
    this.activeRoutingField = 'end';

    // Setam punctul pe harta
    this.updateRoutingPoint('end', centerPoint.latitude, centerPoint.longitude, destName);

    // Setam automat startul la locatia curenta
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

  async searchLocation() {
    if (!this.searchQuery) return;

    const query = this.searchQuery.toLowerCase().trim();

    // incercam o potrivire exacta
    let foundEvent = this.allEventsList.find(e =>
      e.title.toLowerCase() === query
    );

    // incercam o potrivire partiala (primul care contine textul)
    if (!foundEvent) {
      foundEvent = this.allEventsList.find(e =>
        e.title.toLowerCase().includes(query)
      );
    }

    // Daca am găsit un eveniment (exact sau partial), mergem la el
    if (foundEvent) {
      this.selectSearchedEvent(foundEvent);
      this.filteredEvents = []; // Ascundem lista de sugestii dupa selectare
      return;
    }

    // PASUL 2: Geocoding (Daca nu e niciun eveniment)
    const geocodingUrl = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

    try {
      const results = await locator.addressToLocations(geocodingUrl, {
        address: {
          "SingleLine": this.searchQuery
        },
        maxLocations: 1,
        outFields: ["*"]
      });

      if (results.length > 0) {
        const result = results[0];
        const location = result.location;

        this.view.goTo({
          target: location,
          zoom: 12
        });

        this.view.popup.open({
          title: result.address,
          location: location,
          content: "Address found"
        });

        this.filteredEvents = [];

      } else {
        this.toast.showToast("No event or address found.", "warning");
      }

    } catch (error) {
      console.error("Eroare la geocoding:", error);
      this.toast.showToast("Error when searching for address.", "error");
    }
  }

  setUserLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lon = position.coords.longitude;
          const lat = position.coords.latitude;
          this.center = [lon, lat];

          // 1. Centrează harta
          this.view.goTo({ center: this.center, zoom: 14 });

          const point = new Point({ longitude: lon, latitude: lat });

          const symbol = {
            type: "simple-marker",
            style: "circle",
            color: [66, 133, 244],
            size: "14px",
            outline: {
              color: [255, 255, 255], // Margine alba
              width: 2
            }
          };

          // Daca markerul exista deja, ii actualizăm doar geometria
          if (this.userLocationGraphic) {
            this.userLocationGraphic.geometry = point;
          } else {
            // Daca nu exista, il cream si il adaugam pe layer-ul general
            this.userLocationGraphic = new Graphic({
              geometry: point,
              symbol: symbol,
              popupTemplate: {
                title: "Your location",
                content: "You are here."
              }
            });
            this.graphicsLayer.add(this.userLocationGraphic);
          }
        },
        (error) => {
          console.error("Geolocalizare esuata: ", error);
          this.toast.showToast("Current location could not be found.", "warning");
        }
      );
    } else {
      this.toast.showToast("Browser does not support geolocalization.", "error");
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