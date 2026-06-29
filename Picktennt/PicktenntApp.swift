//
//  PicktenntApp.swift
//  Picktennt
//
//  Created by Eduardo Scott on 6/28/26.
//

import SwiftUI
import CoreData

@main
struct PicktenntApp: App {
    let persistenceController = PersistenceController.shared

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.managedObjectContext, persistenceController.container.viewContext)
        }
    }
}
