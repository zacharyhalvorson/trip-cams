//
//  CarPlaySceneDelegate.swift
//  TripCams
//

import CarPlay
import UIKit

@MainActor
class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    var interfaceController: CPInterfaceController?
    private var tripViewModel: TripViewModel? { TripViewModel.shared }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                   didConnect interfaceController: CPInterfaceController) {
        self.interfaceController = interfaceController

        let tabBar = CPTabBarTemplate(templates: [
            createCameraListTemplate(),
            createRouteSelectionTemplate()
        ])

        interfaceController.setRootTemplate(tabBar, animated: true, completion: nil)
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                   didDisconnect interfaceController: CPInterfaceController) {
        self.interfaceController = nil
    }

    // MARK: - Camera List Tab

    private func createCameraListTemplate() -> CPListTemplate {
        let template = CPListTemplate(title: "Cameras", sections: [])
        template.tabImage = UIImage(systemName: "camera")
        updateCameraList(template: template)
        return template
    }

    // MARK: - Route Selection Tab

    private func createRouteSelectionTemplate() -> CPListTemplate {
        guard let viewModel = tripViewModel else {
            return CPListTemplate(title: "Routes", sections: [])
        }

        var items: [CPListItem] = []
        for (routeId, route) in viewModel.routes {
            let item = CPListItem(text: route.name, detailText: "\(route.stops.count) stops")
            item.handler = { [weak self] _, completion in
                self?.showRouteStops(routeId: routeId, route: route)
                completion()
            }
            items.append(item)
        }

        let section = CPListSection(items: items)
        let template = CPListTemplate(title: "Routes", sections: [section])
        template.tabImage = UIImage(systemName: "point.topleft.down.to.point.bottomright.curvepath")
        return template
    }

    // MARK: - Route Stops

    private func showRouteStops(routeId: String, route: Route) {
        let items: [CPListItem] = route.stops.map { stop in
            let item = CPListItem(text: stop.name, detailText: stop.region)
            item.handler = { [weak self] _, completion in
                guard let self = self, let viewModel = self.tripViewModel else {
                    completion()
                    return
                }
                let lastStop = route.stops[route.stops.count - 1]
                Task { @MainActor in
                    viewModel.selectRoute(routeId: routeId, from: stop, to: lastStop)
                    await viewModel.loadCamerasForRoute()
                    if let tabBar = self.interfaceController?.rootTemplate as? CPTabBarTemplate,
                       let cameraTemplate = tabBar.templates.first as? CPListTemplate {
                        self.updateCameraList(template: cameraTemplate)
                    }
                }
                completion()
            }
            return item
        }

        let section = CPListSection(items: items)
        let template = CPListTemplate(title: route.name, sections: [section])
        interfaceController?.pushTemplate(template, animated: true, completion: nil)
    }

    // MARK: - Camera List Updates

    private func updateCameraList(template: CPListTemplate) {
        guard let viewModel = tripViewModel else { return }

        if viewModel.clusters.isEmpty {
            let emptyItem = CPListItem(text: "No cameras loaded", detailText: "Select a route first")
            template.updateSections([CPListSection(items: [emptyItem])])
            return
        }

        let items: [CPListItem] = viewModel.clusters.prefix(12).map { cluster in
            let count = cluster.cameras.count
            let detail = count > 1 ? "\(count) cameras" : cluster.primaryCamera.highway
            let item = CPListItem(text: cluster.name, detailText: detail)
            item.handler = { [weak self] _, completion in
                self?.showClusterDetail(cluster: cluster)
                completion()
            }
            return item
        }

        template.updateSections([CPListSection(items: items)])
    }

    // MARK: - Cluster Detail

    private func showClusterDetail(cluster: CameraCluster) {
        let items: [CPListItem] = cluster.cameras.map { camera in
            let item = CPListItem(text: camera.name, detailText: "\(camera.highway) \(camera.direction)")
            item.handler = { [weak self] _, completion in
                self?.showCameraDetail(camera: camera)
                completion()
            }
            return item
        }

        let template = CPListTemplate(title: cluster.name, sections: [CPListSection(items: items)])
        interfaceController?.pushTemplate(template, animated: true, completion: nil)
    }

    // MARK: - Camera Detail

    private func showCameraDetail(camera: Camera) {
        var items: [CPInformationItem] = [
            CPInformationItem(title: "Highway", detail: camera.highway),
            CPInformationItem(title: "Direction", detail: camera.direction),
            CPInformationItem(title: "Region", detail: camera.region),
        ]

        if let temp = camera.temperature {
            items.append(CPInformationItem(title: "Temperature", detail: "\(Int(temp))\u{00B0}C"))
        }

        let template = CPInformationTemplate(title: camera.name, layout: .leading, items: items, actions: [])
        interfaceController?.pushTemplate(template, animated: true, completion: nil)
    }
}
