/**
 * UASO Explorer - 3D Spacetime Manifold View
 *
 * Three.js visualization showing signals in 3D spacetime
 * where Z-axis represents temporal depth (years BP).
 */

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';

export class ManifoldView {
    constructor(containerId, data) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.data = data;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.signalMeshes = new Map(); // signalId -> mesh
        this.highlightedMesh = null;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.onSignalSelect = null;

        // Coordinate bounds (will be calculated from data)
        this.bounds = {
            lng: { min: -11, max: -5 },
            lat: { min: 51, max: 56 },
            yearsBp: { min: 0, max: 10000 },
        };

        // Scene scale
        this.scale = {
            x: 100, // Longitude scale
            y: 100, // Latitude scale
            z: 50,  // Temporal scale (years BP)
        };

        this.init();
    }

    /**
     * Initialize Three.js scene
     */
    init() {
        // Calculate bounds from data
        this.calculateBounds();

        // Create scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e14);

        // Create camera
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 2000);
        this.camera.position.set(80, 80, 120);

        // Create renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        // Create controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 20;
        this.controls.maxDistance = 500;

        // Add lighting
        this.addLighting();

        // Add grid and axes
        this.addGrid();
        this.addAxes();

        // Add ground plane
        this.addGroundPlane();

        // Add signals
        this.addSignals();

        // Event listeners
        window.addEventListener('resize', this.onResize.bind(this));
        this.renderer.domElement.addEventListener('click', this.onClick.bind(this));
        this.renderer.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));

        // Start animation
        this.animate();
    }

    /**
     * Calculate bounds from data
     */
    calculateBounds() {
        if (!this.data || !this.data.features) return;

        let lngMin = Infinity, lngMax = -Infinity;
        let latMin = Infinity, latMax = -Infinity;
        let ybpMin = Infinity, ybpMax = -Infinity;

        this.data.features.forEach(feature => {
            const coords = feature.geometry?.coordinates;
            if (coords && coords.length >= 2) {
                const [lng, lat] = coords;
                lngMin = Math.min(lngMin, lng);
                lngMax = Math.max(lngMax, lng);
                latMin = Math.min(latMin, lat);
                latMax = Math.max(latMax, lat);
            }

            const yearsBp = feature.properties?.temporal_vector?.years_bp;
            if (yearsBp !== null && yearsBp !== undefined) {
                ybpMin = Math.min(ybpMin, yearsBp);
                ybpMax = Math.max(ybpMax, yearsBp);
            }
        });

        // Set bounds with some padding
        if (lngMin !== Infinity) {
            this.bounds.lng = { min: lngMin - 0.5, max: lngMax + 0.5 };
            this.bounds.lat = { min: latMin - 0.5, max: latMax + 0.5 };
        }
        if (ybpMin !== Infinity && ybpMax > 0) {
            this.bounds.yearsBp = { min: 0, max: ybpMax * 1.1 };
        }
    }

    /**
     * Add lighting to the scene
     */
    addLighting() {
        // Ambient light
        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);

        // Directional light
        const directional = new THREE.DirectionalLight(0xffffff, 0.6);
        directional.position.set(50, 100, 50);
        this.scene.add(directional);

        // Point light for signals
        const point = new THREE.PointLight(0x61afef, 0.5, 200);
        point.position.set(0, 50, 0);
        this.scene.add(point);
    }

    /**
     * Add grid helper
     */
    addGrid() {
        const gridHelper = new THREE.GridHelper(
            this.scale.x,
            20,
            0x2d3548,
            0x1a1f2e
        );
        gridHelper.position.y = 0;
        this.scene.add(gridHelper);
    }

    /**
     * Add axes helper
     */
    addAxes() {
        // X axis (red) - Longitude
        const xGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-this.scale.x / 2, 0, 0),
            new THREE.Vector3(this.scale.x / 2, 0, 0),
        ]);
        const xMat = new THREE.LineBasicMaterial({ color: 0xe06c75 });
        const xAxis = new THREE.Line(xGeom, xMat);
        this.scene.add(xAxis);

        // Y axis (green) - Latitude
        const yGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, -this.scale.y / 2),
            new THREE.Vector3(0, 0, this.scale.y / 2),
        ]);
        const yMat = new THREE.LineBasicMaterial({ color: 0x98c379 });
        const yAxis = new THREE.Line(yGeom, yMat);
        this.scene.add(yAxis);

        // Z axis (blue) - Years BP
        const zGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, this.scale.z, 0),
        ]);
        const zMat = new THREE.LineBasicMaterial({ color: 0x61afef });
        const zAxis = new THREE.Line(zGeom, zMat);
        this.scene.add(zAxis);
    }

    /**
     * Add semi-transparent ground plane
     */
    addGroundPlane() {
        const geometry = new THREE.PlaneGeometry(this.scale.x, this.scale.y);
        const material = new THREE.MeshBasicMaterial({
            color: 0x1a1f2e,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
        });
        const plane = new THREE.Mesh(geometry, material);
        plane.rotation.x = -Math.PI / 2;
        plane.position.y = 0;
        this.scene.add(plane);
    }

    /**
     * Add signals to the scene
     */
    addSignals() {
        if (!this.data || !this.data.features) return;

        // Create instanced mesh for better performance
        const geometry = new THREE.SphereGeometry(0.8, 16, 16);

        this.data.features.forEach(feature => {
            const mesh = this.createSignalMesh(feature, geometry);
            if (mesh) {
                this.scene.add(mesh);
            }
        });
    }

    /**
     * Create mesh for a signal
     */
    createSignalMesh(feature, sharedGeometry) {
        const coords = feature.geometry?.coordinates;
        if (!coords || coords.length < 2) return null;

        const [lng, lat] = coords;
        const props = feature.properties || {};
        const metadata = props.signal_metadata || {};
        const temporal = props.temporal_vector || {};

        const signalId = feature.id || metadata.signal_id;
        const quality = metadata.signal_quality || 0.5;
        const yearsBp = temporal.years_bp || 0;

        // Calculate position
        const x = this.mapValue(lng, this.bounds.lng.min, this.bounds.lng.max, -this.scale.x / 2, this.scale.x / 2);
        const z = this.mapValue(lat, this.bounds.lat.min, this.bounds.lat.max, -this.scale.y / 2, this.scale.y / 2);
        const y = this.mapValue(yearsBp, this.bounds.yearsBp.min, this.bounds.yearsBp.max, 0, this.scale.z);

        // Create material with quality-based color
        const color = this.getQualityColor(quality);
        const material = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.3,
            metalness: 0.5,
            roughness: 0.5,
        });

        const mesh = new THREE.Mesh(sharedGeometry, material);
        mesh.position.set(x, y, z);
        mesh.userData = { signalId, quality, yearsBp, feature };

        this.signalMeshes.set(signalId, mesh);
        return mesh;
    }

    /**
     * Map value from one range to another
     */
    mapValue(value, inMin, inMax, outMin, outMax) {
        return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
    }

    /**
     * Get color based on quality
     */
    getQualityColor(quality) {
        if (quality >= 0.8) return 0x98c379;
        if (quality >= 0.5) return 0xe5c07b;
        return 0xe06c75;
    }

    /**
     * Handle window resize
     */
    onResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    /**
     * Handle click events
     */
    onClick(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        const meshes = Array.from(this.signalMeshes.values());
        const intersects = this.raycaster.intersectObjects(meshes);

        if (intersects.length > 0) {
            const mesh = intersects[0].object;
            const signalId = mesh.userData.signalId;
            if (this.onSignalSelect) {
                this.onSignalSelect(signalId);
            }
        }
    }

    /**
     * Handle mouse move for hover effects
     */
    onMouseMove(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        const meshes = Array.from(this.signalMeshes.values());
        const intersects = this.raycaster.intersectObjects(meshes);

        // Reset cursor
        this.renderer.domElement.style.cursor = intersects.length > 0 ? 'pointer' : 'default';
    }

    /**
     * Highlight a signal
     */
    highlightSignal(signalId) {
        this.clearHighlight();

        const mesh = this.signalMeshes.get(signalId);
        if (!mesh) return;

        this.highlightedMesh = mesh;

        // Scale up and change emissive
        mesh.scale.set(2, 2, 2);
        mesh.material.emissiveIntensity = 0.8;

        // Move camera to look at signal
        const pos = mesh.position;
        this.controls.target.set(pos.x, pos.y, pos.z);
    }

    /**
     * Clear highlight
     */
    clearHighlight() {
        if (this.highlightedMesh) {
            this.highlightedMesh.scale.set(1, 1, 1);
            this.highlightedMesh.material.emissiveIntensity = 0.3;
            this.highlightedMesh = null;
        }
    }

    /**
     * Reset camera position
     */
    resetCamera() {
        this.camera.position.set(80, 80, 120);
        this.controls.target.set(0, this.scale.z / 4, 0);
        this.controls.update();
    }

    /**
     * Animation loop
     */
    animate() {
        requestAnimationFrame(this.animate.bind(this));

        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Cleanup
     */
    dispose() {
        window.removeEventListener('resize', this.onResize);
        this.renderer.dispose();
        this.controls.dispose();
    }
}
