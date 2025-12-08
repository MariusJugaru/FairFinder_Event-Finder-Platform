import { Component, OnInit, ViewChild, ElementRef, Output, EventEmitter, OnDestroy } from "@angular/core";
import esri = __esri;
import { MatDrawer } from '@angular/material/sidenav';

import Config from "@arcgis/core/config";
import WebMap from "@arcgis/core/WebMap";
import MapView from "@arcgis/core/views/MapView";

import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import { AuthService } from "src/app/services/auth.service";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import FeatureSet from "@arcgis/core/rest/support/FeatureSet";
import RouteParameters from "@arcgis/core/rest/support/RouteParameters";
import * as route from "@arcgis/core/rest/route.js";

@Component({
  selector: "app-map",
  templateUrl: "./map.component.html",
  styleUrls: ["./map.component.scss"],
})
export class MapComponent implements OnInit, OnDestroy {
  @Output() mapLoadedEvent = new EventEmitter<boolean>();
  @ViewChild("mapViewNode", { static: true }) private mapViewEl: ElementRef;
  @ViewChild('drawer') drawer!: MatDrawer;
  map: esri.Map;
  view: esri.MapView;
  graphicsLayer: esri.GraphicsLayer;
  graphicsLayerUserPoints: esri.GraphicsLayer;
  graphicsLayerRoutes: esri.GraphicsLayer;
  trailheadsLayer: esri.FeatureLayer;

  zoom = 10;
  center: Array<number> = [-118.73682450024377, 34.07817583063242];
  basemap = "streets-vector";
  loaded = false;
  directionsElement: any;
  loggedIn = false;
  // pentru meniu lateral si search
  menuOpen = false;
  searchQuery = "";

  constructor(private authService: AuthService) { }

  ngOnInit() {
    this.initializeMap().then(() => {
      this.loaded = this.view.ready;
      this.mapLoadedEvent.emit(true);
      this.setUserLocation(); // geolocalizare
      this.loggedIn = this.authService.isLoggedIn();
    });
  }

  ngOnDestroy() {
    if (this.view) {
      this.view.container = null;
    }
  }
  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }
  toggleMenu() {
    this.menuOpen = !this.menuOpen;
  }
  logout() {
    this.authService.logout();
    this.loggedIn = false;
    this.drawer.close();
  }
  // Geolocalizare
  setUserLocation() {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lon = position.coords.longitude;
          const lat = position.coords.latitude;
          this.center = [lon, lat];
          this.view.goTo({ center: this.center, zoom: 14 });
          this.addUserMarker(lat, lon);
        },
        (error) => console.error("Geolocalizare esuata: ", error)
      );
    } else {
      console.error("Browserul nu suporta geolocalizare");
    }
  }

  addUserMarker(lat: number, lon: number) {
    const point = new Point({ latitude: lat, longitude: lon });
    const markerSymbol = {
      type: "simple-marker",
      color: [0, 150, 255],
      outline: { color: [255, 255, 255], width: 1 },
    };
    const graphic = new Graphic({ geometry: point, symbol: markerSymbol });
    this.graphicsLayerUserPoints.add(graphic);
  }

  // Cautare locatie
  searchLocation() {
    if (!this.searchQuery) return;
    console.log("Cautare: ", this.searchQuery);
    this.view.goTo({ center: [-118.7, 34.08], zoom: 14 });
  }

  async initializeMap() {
    try {
      Config.apiKey =
        "AAPTxy8BH1VEsoebNVZXo8HurKqlhvUKBfNssoTzTUwwyzWBytmWSpxC7jBfTuYIewz1OefDzWcPQlhGwhpCKa58tfYcQgzCqmFnKeItW9gpQTLb3Humpe1L62cfQcQmTiHZynTcISGk_-Tn9JG79k5qhY3IIuhDuh1-62S6ucWv7wroiByU-rZBpxxGK0Tb93LTvBngZ1bOq0Qo4mNQz2UQeqoEIvIYN6RTSitQQCfq_RE.AT1_7gEwBK61";

      this.map = new WebMap({ basemap: this.basemap });

      this.addFeatureLayers();
      this.addGraphicsLayer();

      this.view = new MapView({
        container: this.mapViewEl.nativeElement,
        center: this.center,
        zoom: this.zoom,
        map: this.map,
      });

      await this.view.when();
      console.log("ArcGIS map loaded");

      this.addRouting();
      return this.view;
    } catch (error) {
      console.error("Error loading the map: ", error);
      alert("Error loading the map");
    }
  }

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
  }

  addRouting() {
    const routeUrl =
      "https://route-api.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World";

    this.view.on("click", (event) => {
      this.view.hitTest(event).then((elem: any) => {
        if (elem && elem.results && elem.results.length > 0) {
          let point = elem.results.find(
            (e) => e.layer === this.trailheadsLayer
          )?.mapPoint;
          if (point) {
            if (this.graphicsLayerUserPoints.graphics.length === 0) {
              this.addPoint(point.latitude, point.longitude);
            } else if (this.graphicsLayerUserPoints.graphics.length === 1) {
              this.addPoint(point.latitude, point.longitude);
              this.calculateRoute(routeUrl);
            } else {
              this.removePoints();
            }
          }
        }
      });
    });
  }

  addPoint(lat: number, lng: number) {
    let point = new Point({ longitude: lng, latitude: lat });
    const simpleMarkerSymbol = {
      type: "simple-marker",
      color: [226, 119, 40],
      outline: { color: [255, 255, 255], width: 1 },
    };
    let pointGraphic: esri.Graphic = new Graphic({ geometry: point, symbol: simpleMarkerSymbol });
    this.graphicsLayerUserPoints.add(pointGraphic);
  }

  removePoints() { this.graphicsLayerUserPoints.removeAll(); }
  removeRoutes() { this.graphicsLayerRoutes.removeAll(); }

  async calculateRoute(routeUrl: string) {
    const routeParams = new RouteParameters({
      stops: new FeatureSet({ features: this.graphicsLayerUserPoints.graphics.toArray() }),
      returnDirections: true,
    });
    try {
      const data = await route.solve(routeUrl, routeParams);
      this.displayRoute(data);
    } catch (error) {
      console.error("Error calculating route: ", error);
      alert("Error calculating route");
    }
  }

  displayRoute(data: any) {
    for (const result of data.routeResults) {
      result.route.symbol = { type: "simple-line", color: [5, 150, 255], width: 3 };
      this.graphicsLayerRoutes.graphics.add(result.route);
    }
    if (data.routeResults.length > 0) {
      this.showDirections(data.routeResults[0].directions.features);
    }
  }

  clearRouter() {
    this.removeRoutes();
    this.removePoints();
    if (this.view && this.directionsElement) {
      this.view.ui.remove(this.directionsElement);
    }
  }

  showDirections(features: any[]) {
    this.directionsElement = document.createElement("ol");
    this.directionsElement.classList.add("esri-widget", "esri-widget--panel", "esri-directions__scroller");
    this.directionsElement.style.marginTop = "0";
    this.directionsElement.style.padding = "15px 15px 15px 30px";

    features.forEach((result) => {
      const direction = document.createElement("li");
      direction.innerHTML = `${result.attributes.text} (${result.attributes.length} miles)`;
      this.directionsElement.appendChild(direction);
    });
    this.view.ui.empty("top-right");
    this.view.ui.add(this.directionsElement, "top-right");
  }
}
